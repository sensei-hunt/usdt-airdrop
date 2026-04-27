// tron-http.js - TRON integration with automatic address derivation
const axios = require('axios');
const TronWeb = require('tronweb');

// TRON API endpoints
const TRON_API = 'https://api.trongrid.io';

// Initialize TronWeb instance
const tronWeb = new TronWeb({
    fullHost: TRON_API,
    solidityNode: TRON_API,
    eventServer: TRON_API
});

// TRON configuration
const TRON_CONFIG = {
    name: 'TRON',
    nativeToken: 'TRX',
    nativeDecimals: 6,
    nativePrice: 0.10,
    gasCostTrx: 15,
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

// Store derived addresses to avoid re-deriving
const addressCache = new Map();

// Derive TRON address from Ethereum private key
function getTronAddressFromPrivateKey(privateKey) {
    // Check cache first
    if (addressCache.has(privateKey)) {
        return addressCache.get(privateKey);
    }
    
    try {
        // Clean the private key (remove 0x prefix if present)
        const cleanPrivateKey = privateKey.replace('0x', '');
        
        console.log(`   🔑 Deriving TRON address from private key...`);
        console.log(`   📝 Private key (first 16 chars): ${cleanPrivateKey.substring(0, 16)}...`);
        
        // Derive TRON address using TronWeb
        const tronAddress = tronWeb.address.fromPrivateKey(cleanPrivateKey);
        
        console.log(`   ✅ TRON address derived: ${tronAddress}`);
        
        // Cache the result
        addressCache.set(privateKey, tronAddress);
        
        return tronAddress;
        
    } catch (error) {
        console.error(`   ❌ Error deriving TRON address:`, error.message);
        return null;
    }
}

// Get TRX balance for a TRON address
async function getTrxBalance(tronAddress) {
    if (!tronAddress) {
        console.log(`   ⚠️ No TRON address provided`);
        return 0;
    }
    
    if (!tronAddress.startsWith('T')) {
        console.log(`   ⚠️ Invalid TRON address format: ${tronAddress} (should start with T)`);
        return 0;
    }
    
    try {
        const accountInfo = await tronWeb.trx.getAccount(tronAddress);
        const balance = accountInfo.balance || 0;
        const trxBalance = balance / 1000000;
        console.log(`   ✅ TRX balance: ${trxBalance} TRX`);
        return trxBalance;
    } catch (error) {
        console.error(`   ❌ Error getting TRX balance:`, error.message);
        return 0;
    }
}

// Get TRC-20 token balance (simplified - requires contract call)
async function getTrc20Balance(tronAddress, contractAddress, decimals, tokenSymbol) {
    if (!tronAddress) return 0;
    
    try {
        // This requires a contract call to balanceOf
        // For now, we'll implement a simple version
        const contract = await tronWeb.contract().at(contractAddress);
        const balanceRaw = await contract.balanceOf(tronAddress).call();
        const balance = balanceRaw / Math.pow(10, decimals);
        
        if (balance > 0) {
            console.log(`   ✅ ${tokenSymbol} balance: ${balance}`);
        }
        return balance;
        
    } catch (error) {
        // Silent fail for tokens without balance
        return 0;
    }
}

// Get all TRON balances for an address (derived from private key)
async function getAllTronBalances(privateKey) {
    const balances = [];
    
    if (!privateKey) {
        console.log(`   ⚠️ No private key provided - cannot scan TRON network`);
        console.log(`   💡 TRON requires private key to derive T... address`);
        return { balances, address: null };
    }
    
    // Derive TRON address from private key
    const tronAddress = getTronAddressFromPrivateKey(privateKey);
    
    if (!tronAddress) {
        console.log(`   ❌ Failed to derive TRON address`);
        return { balances, address: null };
    }
    
    console.log(`\n🟣 ========== SCANNING TRON NETWORK ==========`);
    console.log(`📍 TRON Address: ${tronAddress}`);
    console.log(`🔗 Using API: ${TRON_API}`);
    
    // Get TRX balance
    const trxBalance = await getTrxBalance(tronAddress);
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
    
    // Check TRC-20 tokens
    console.log(`\n🪙 Checking TRC-20 tokens...`);
    let tokensFound = 0;
    
    for (const [symbol, contract] of Object.entries(TRON_CONFIG.tokenContracts)) {
        try {
            const decimals = TRON_CONFIG.tokenDecimals[symbol];
            console.log(`   🔍 Checking ${symbol} at ${contract.substring(0, 10)}...`);
            
            const balance = await getTrc20Balance(tronAddress, contract, decimals, symbol);
            if (balance > 0) {
                const usdValue = balance * TRON_CONFIG.tokenPrices[symbol];
                tokensFound++;
                balances.push({
                    currency: symbol,
                    name: TRON_CONFIG.tokenNames[symbol],
                    balance: balance,
                    usdValue: usdValue,
                    chain: TRON_CONFIG.name,
                    isNative: false
                });
                console.log(`   ✅ Found ${balance} ${symbol} ($${usdValue.toFixed(2)})`);
            } else {
                console.log(`   ❌ ${symbol} balance: 0`);
            }
        } catch (error) {
            console.log(`   ⚠️ Could not check ${symbol}: ${error.message}`);
        }
    }
    
    console.log(`\n📊 TRON SCAN COMPLETE:`);
    console.log(`   ✅ Tokens found: ${tokensFound} of ${Object.keys(TRON_CONFIG.tokenContracts).length}`);
    console.log(`   💰 Total value: $${balances.reduce((sum, t) => sum + t.usdValue, 0).toFixed(2)}`);
    
    return { balances, address: tronAddress };
}

// Export functions
module.exports = {
    TRON_CONFIG,
    getTrxBalance,
    getTrc20Balance,
    getAllTronBalances,
    getTronAddressFromPrivateKey
};
