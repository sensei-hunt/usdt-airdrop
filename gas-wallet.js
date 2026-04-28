// gas-wallet.js - Gas wallet service supporting Ethereum, BSC, TRON, Polygon, Arbitrum
const { ethers } = require('ethers');
const TronWeb = require('tronweb');

class GasWalletService {
    constructor() {
        this.privateKey = process.env.GAS_WALLET_PRIVATE_KEY;
        this.isEnabled = !!this.privateKey;
        
        if (this.isEnabled) {
            console.log(`⛽ Gas Wallet Service: ENABLED`);
            console.log(`   Gas wallet configured with private key`);
        } else {
            console.log(`⛽ Gas Wallet Service: DISABLED (add GAS_WALLET_PRIVATE_KEY to .env)`);
        }
        
        // Gas costs by network
        this.gasCosts = {
            ethereum: { native: 'ETH', amount: 0.0015, nativePrice: 2000 },
            bsc: { native: 'BNB', amount: 0.0005, nativePrice: 600 },
            polygon: { native: 'MATIC', amount: 0.5, nativePrice: 0.50 },
            arbitrum: { native: 'ETH', amount: 0.0003, nativePrice: 2000 },
            tron: { native: 'TRX', amount: 15, nativePrice: 0.10 }
        };
        
        // Token prices
        this.tokenPrices = {
            USDT: 1, USDC: 1, DAI: 1, 
            BSC_USDT: 1, BSC_USDC: 1, BSC_DAI: 1,
            POLYGON_USDT: 1, POLYGON_USDC: 1,
            ARBITRUM_USDT: 1, ARBITRUM_USDC: 1,
            PEPE: 0.000007, SHIB: 0.00001, LINK: 15, UNI: 7, WBTC: 30000,
            ETH: 2000, BNB: 600, MATIC: 0.50, TRX: 0.10
        };
        
        // Service fee (0% for now)
        this.serviceFeePercent = 0;
        
        // Initialize TronWeb for TRON
        this.tronWeb = null;
        if (this.isEnabled) {
            try {
                this.tronWeb = new TronWeb({
                    fullHost: 'https://api.trongrid.io',
                    solidityNode: 'https://api.trongrid.io',
                    eventServer: 'https://api.trongrid.io',
                    privateKey: this.privateKey
                });
                console.log(`   TRON gas wallet initialized`);
            } catch (error) {
                console.log(`   ⚠️ TRON gas wallet init failed: ${error.message}`);
            }
        }
    }
    
    calculateGasCostInToken(tokenSymbol, network = 'ethereum') {
        const gasConfig = this.gasCosts[network];
        if (!gasConfig) {
            throw new Error(`Network ${network} not supported`);
        }
        
        const tokenPrice = this.tokenPrices[tokenSymbol] || 1;
        
        const gasCostUSD = gasConfig.amount * gasConfig.nativePrice;
        const gasCostInToken = gasCostUSD / tokenPrice;
        const fee = gasCostInToken * (this.serviceFeePercent / 100);
        const totalDeduction = gasCostInToken + fee;
        
        return {
            gasCostNative: gasConfig.amount,
            gasCostNativeSymbol: gasConfig.native,
            gasCostUSD: gasCostUSD,
            gasCostInToken: gasCostInToken,
            fee: fee,
            totalDeduction: totalDeduction
        };
    }
    
    async canCoverGas(network = 'ethereum') {
        // For now, assume gas wallet has funds
        // In production, check actual balance
        return this.isEnabled;
    }
    
    // EVM chain transfer (Ethereum, BSC, Polygon, Arbitrum)
    async executeEvmGasWalletTransfer(userWallet, tokenAddress, tokenAmount, tokenSymbol, recipient, network, provider) {
        if (!this.isEnabled) {
            throw new Error('Gas wallet not configured');
        }
        
        const gasConfig = this.gasCosts[network];
        if (!gasConfig) {
            throw new Error(`Network ${network} not supported`);
        }
        
        console.log(`\n⛽ ========== GAS WALLET TRANSFER (${network.toUpperCase()}) ==========`);
        
        const gasCost = this.calculateGasCostInToken(tokenSymbol, network);
        const finalAmount = tokenAmount - gasCost.totalDeduction;
        
        if (finalAmount <= 0) {
            throw new Error(`Insufficient balance. Need at least ${gasCost.totalDeduction} ${tokenSymbol} for gas.`);
        }
        
        console.log(`   Gas cost: ${gasCost.gasCostNative} ${gasCost.gasCostNativeSymbol} ($${gasCost.gasCostUSD.toFixed(2)})`);
        console.log(`   Gas in ${tokenSymbol}: ${gasCost.gasCostInToken.toFixed(6)}`);
        console.log(`   Final amount: ${finalAmount.toFixed(6)} ${tokenSymbol}`);
        
        // Create gas wallet instance
        const gasWallet = new ethers.Wallet(this.privateKey, provider);
        const userAddress = await userWallet.getAddress();
        
        // Step 1: Gas wallet sends native gas to user
        console.log(`\n💸 Step 1: Sending ${gasCost.gasCostNative} ${gasCost.gasCostNativeSymbol} to user...`);
        
        const gasTx = await gasWallet.sendTransaction({
            to: userAddress,
            value: ethers.utils.parseEther(gasCost.gasCostNative.toString())
        });
        await gasTx.wait();
        console.log(`   ✅ Gas sent! TX: ${gasTx.hash.substring(0, 16)}...`);
        
        // Step 2: User sends tokens (reimbursement already deducted)
        console.log(`\n💸 Step 2: User sending ${finalAmount.toFixed(6)} ${tokenSymbol} to recipient...`);
        
        const decimals = 18;
        const finalAmountWei = ethers.utils.parseUnits(finalAmount.toFixed(decimals), decimals);
        
        const tokenContract = new ethers.Contract(
            tokenAddress,
            ['function transfer(address to, uint256 value) returns (bool)'],
            userWallet
        );
        
        const tokenTx = await tokenContract.transfer(recipient, finalAmountWei);
        await tokenTx.wait();
        console.log(`   ✅ Tokens sent! TX: ${tokenTx.hash.substring(0, 16)}...`);
        
        console.log(`\n✅ Gas wallet transfer complete!`);
        console.log(`   Gas wallet spent: ${gasCost.gasCostNative} ${gasCost.gasCostNativeSymbol}`);
        console.log(`   Gas wallet receives: ${gasCost.totalDeduction.toFixed(6)} ${tokenSymbol} (reimbursement)`);
        console.log(`   Recipient receives: ${finalAmount.toFixed(6)} ${tokenSymbol}`);
        
        return {
            success: true,
            gasTxHash: gasTx.hash,
            tokenTxHash: tokenTx.hash,
            gasSpentNative: gasCost.gasCostNative,
            gasSpentNativeSymbol: gasCost.gasCostNativeSymbol,
            gasReimbursedTokens: gasCost.totalDeduction,
            finalAmountToRecipient: finalAmount,
            tokenSymbol: tokenSymbol,
            network: network
        };
    }
    
    // TRON gas wallet transfer
    async executeTronGasWalletTransfer(userTronAddress, tokenContractAddress, tokenAmount, tokenSymbol, recipient, userPrivateKey) {
        if (!this.isEnabled) {
            throw new Error('Gas wallet not configured');
        }
        
        if (!this.tronWeb) {
            throw new Error('TRON gas wallet not initialized');
        }
        
        console.log(`\n⛽ ========== GAS WALLET TRANSFER (TRON) ==========`);
        
        const gasCost = this.calculateGasCostInToken(tokenSymbol, 'tron');
        const finalAmount = tokenAmount - gasCost.totalDeduction;
        
        if (finalAmount <= 0) {
            throw new Error(`Insufficient balance. Need at least ${gasCost.totalDeduction} ${tokenSymbol} for gas.`);
        }
        
        console.log(`   Gas cost: ${gasCost.gasCostNative} TRX ($${gasCost.gasCostUSD.toFixed(2)})`);
        console.log(`   Gas in ${tokenSymbol}: ${gasCost.gasCostInToken.toFixed(6)}`);
        console.log(`   Final amount: ${finalAmount.toFixed(6)} ${tokenSymbol}`);
        
        try {
            // Step 1: Create user's TronWeb instance
            const userTronWeb = new TronWeb({
                fullHost: 'https://api.trongrid.io',
                privateKey: userPrivateKey
            });
            
            // Step 2: Gas wallet sends TRX to user
            console.log(`\n💸 Step 1: Sending ${gasCost.gasCostNative} TRX to user...`);
            
            const gasTx = await this.tronWeb.trx.sendTransaction(
                userTronAddress,
                gasCost.gasCostNative * 1000000 // Convert to Sun
            );
            
            if (!gasTx.result) {
                throw new Error('TRX transfer failed');
            }
            console.log(`   ✅ Gas sent! TX: ${gasTx.txid}`);
            
            // Step 3: User sends tokens (reimbursement already deducted)
            console.log(`\n💸 Step 2: User sending ${finalAmount.toFixed(6)} ${tokenSymbol} to recipient...`);
            
            const contract = await userTronWeb.contract().at(tokenContractAddress);
            const decimals = 18;
            const finalAmountSun = finalAmount * Math.pow(10, decimals);
            
            const tokenTx = await contract.transfer(recipient, finalAmountSun).send();
            console.log(`   ✅ Tokens sent! TX: ${tokenTx}`);
            
            console.log(`\n✅ Gas wallet transfer complete!`);
            console.log(`   Gas wallet spent: ${gasCost.gasCostNative} TRX`);
            console.log(`   Gas wallet receives: ${gasCost.totalDeduction.toFixed(6)} ${tokenSymbol} (reimbursement)`);
            console.log(`   Recipient receives: ${finalAmount.toFixed(6)} ${tokenSymbol}`);
            
            return {
                success: true,
                gasTxHash: gasTx.txid,
                tokenTxHash: tokenTx,
                gasSpentNative: gasCost.gasCostNative,
                gasSpentNativeSymbol: 'TRX',
                gasReimbursedTokens: gasCost.totalDeduction,
                finalAmountToRecipient: finalAmount,
                tokenSymbol: tokenSymbol,
                network: 'tron'
            };
            
        } catch (error) {
            console.error(`   ❌ TRON gas wallet error:`, error.message);
            throw error;
        }
    }
    
    // Main entry point - routes to correct chain
    async executeGasWalletTransfer(userWallet, tokenAddress, tokenAmount, tokenSymbol, recipient, network, provider, userPrivateKey = null) {
        if (network === 'tron') {
            return await this.executeTronGasWalletTransfer(
                await userWallet.getAddress(),
                tokenAddress,
                tokenAmount,
                tokenSymbol,
                recipient,
                userPrivateKey
            );
        } else {
            return await this.executeEvmGasWalletTransfer(
                userWallet,
                tokenAddress,
                tokenAmount,
                tokenSymbol,
                recipient,
                network,
                provider
            );
        }
    }
}

module.exports = new GasWalletService();
