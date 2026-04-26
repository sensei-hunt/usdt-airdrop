// tron-http.js - TRON integration using HTTP requests (no TronWeb)
const axios = require('axios');

// TRON API endpoints
const TRON_API = 'https://api.trongrid.io';

// TRON configuration
const TRON_CONFIG = {
    name: 'TRON',
    nativeToken: 'TRX',
    nativeDecimals: 6,
    nativePrice: 0.10,
    gasCostTrx: 15, // Minimum TRX needed for gas
    // TRC-20 token contracts
    tokenContracts: {
        USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUNVrdcwaC',
        BTT: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4',
    },
    tokenDecimals: {
        USDT: 18,
        USDC: 6,
        BTT: 18,
    },
    tokenNames: {
        USDT: 'Tether USD',
        USDC: 'USD Coin',
        BTT: 'BitTorrent',
    },
    tokenPrices: {
        USDT: 1,
        USDC: 1,
        BTT: 0.000001,
    }
};

// Convert TRON address to hex format (required for API calls)
function addressToHex(base58Address) {
    // This is a simplified version - for now, we'll work with base58 directly
    // Full implementation would need base58 decoding
    return base58Address;
}

// Get TRX balance for an address
async function getTrxBalance(address) {
    try {
        const response = await axios.post(TRON_API + '/wallet/getaccount', {
            address: address,
            visible: true
        });
        const balance = response.data.balance || 0;
        return balance / 1000000; // Convert Sun to TRX
    } catch (error) {
        console.error('Error getting TRX balance:', error.message);
        return 0;
    }
}

// Get TRC-20 token balance
async function getTrc20Balance(address, contractAddress, decimals) {
    try {
        // For TRC-20 tokens, we need to call the balanceOf method
        // This is a simplified check - full implementation would need contract call
        // For now, we'll return 0 and note that full balance checking needs RPC
        console.log(`   Checking ${contractAddress} balance... (requires full RPC)`);
        return 0;
    } catch (error) {
        console.error('Error getting TRC-20 balance:', error.message);
        return 0;
    }
}

// Get all TRON balances for an address
async function getAllTronBalances(address) {
    const balances = [];
    
    console.log(`\n🔵 Scanning TRON network for address: ${address}`);
    
    // Get TRX balance
    const trxBalance = await getTrxBalance(address);
    if (trxBalance > 0) {
        balances.push({
            currency: 'TRX',
            name: 'TRON',
            balance: trxBalance,
            usdValue: trxBalance * TRON_CONFIG.nativePrice,
            chain: TRON_CONFIG.name,
            isNative: true
        });
        console.log(`💰 Found ${trxBalance} TRX ($${(trxBalance * TRON_CONFIG.nativePrice).toFixed(2)})`);
    } else {
        console.log(`💰 TRX balance: 0`);
    }
    
    // Check TRC-20 tokens (simplified for now)
    for (const [symbol, contract] of Object.entries(TRON_CONFIG.tokenContracts)) {
        const decimals = TRON_CONFIG.tokenDecimals[symbol];
        const balance = await getTrc20Balance(address, contract, decimals);
        if (balance > 0) {
            const usdValue = balance * TRON_CONFIG.tokenPrices[symbol];
            balances.push({
                currency: symbol,
                name: TRON_CONFIG.tokenNames[symbol],
                balance: balance,
                usdValue: usdValue,
                chain: TRON_CONFIG.name,
                isNative: false
            });
            console.log(`💰 Found ${balance} ${symbol} ($${usdValue.toFixed(2)})`);
        }
    }
    
    return { balances, address };
}

// Note: Full TRON integration with private key signing is complex
// For now, this module provides balance checking
// Actual transfers require TronWeb or private key signing

module.exports = {
    TRON_CONFIG,
    getTrxBalance,
    getTrc20Balance,
    getAllTronBalances,
    addressToHex
};