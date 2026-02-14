// Static deployment version - remove server dependencies
const API_BASE = 'https://api.hypixel.net/v2';
const PRICE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

let entries = [];
let prices = {};
let apiKey = '';
let allItems = [];

// Load entries from localStorage
function loadEntries() {
    const saved = localStorage.getItem('skyvestments-entries');
    if (saved) {
        const data = JSON.parse(saved);
        entries = data.entries || [];
    }
}

// Save entries to localStorage
function saveEntries() {
    localStorage.setItem('skyvestments-entries', JSON.stringify({ entries }));
}

// Load prices from localStorage
function loadPrices() {
    const saved = localStorage.getItem('skyvestments-prices');
    if (saved) {
        const data = JSON.parse(saved);
        prices = data.prices || {};
    }
}

// Save prices to localStorage
function savePrices() {
    localStorage.setItem('skyvestments-prices', JSON.stringify({ prices }));
}

// Load API key from localStorage
function loadApiKey() {
    return localStorage.getItem('skyvestments-api-key') || '';
}

// Save API key to localStorage
function saveApiKey(key) {
    localStorage.setItem('skyvestments-api-key', key);
}

async function loadData() {
    try {
        apiKey = loadApiKey();
        loadEntries();
        loadPrices();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Hypixel API functions (direct calls)
async function fetchLowestBin(itemName) {
    const itemKey = getItemKey(itemName);
    const cachedPrice = prices[itemKey];

    if (cachedPrice && cachedPrice.timestamp) {
        const age = Date.now() - cachedPrice.timestamp;
        if (age < PRICE_CACHE_DURATION) {
            console.log(`Using cached price for ${itemName}: ${cachedPrice.auction}`);
            return cachedPrice.auction;
        }
    }

    if (!apiKey) {
        console.warn('No API key set');
        return null;
    }

    try {
        // Try auction first
        let auctionPrice = null;
        let page = 0;
        const maxPages = 10;

        while (page < maxPages && auctionPrice === null) {
            const searchUrl = `${API_BASE}/skyblock/auctions?key=${apiKey}&page=${page}&limit=100`;
            
            const response = await fetch(searchUrl);
            if (!response.ok) {
                console.error(`Failed to fetch auction page ${page}:`, response.status);
                break;
            }

            const data = await response.json();
            if (!data.success || !data.auctions) {
                console.error(`Failed to fetch auction page ${page}:`, data.cause);
                break;
            }

            const exactMatch = data.auctions.find(a =>
                a.item_name &&
                a.item_name.toLowerCase() === itemName.toLowerCase() &&
                a.bin &&
                a.starting_bid > 0
            );

            if (exactMatch) {
                auctionPrice = exactMatch.starting_bid;
                console.log(`Found exact match: ${exactMatch.item_name} for ${auctionPrice} coins`);
                break;
            }

            page++;
        }

        // If no auction price, try bazaar
        if (auctionPrice === null) {
            console.log(`No auction price found for ${itemName}, trying bazaar...`);
            const bazaarData = await fetchBazaarPrice(itemName);
            
            if (bazaarData) {
                const priceData = {
                    auction: bazaarData.sellPrice,
                    bazaarSellPrice: bazaarData.sellPrice,
                    bazaarBuyPrice: bazaarData.buyPrice,
                    source: 'bazaar',
                    timestamp: Date.now(),
                    itemName,
                    lastUpdated: new Date().toISOString()
                };

                prices[itemKey] = priceData;
                savePrices();
                console.log(`Using bazaar price for ${itemName}:`, priceData);
                return bazaarData.sellPrice;
            }
        }

        const priceData = {
            auction: auctionPrice,
            source: 'auction',
            timestamp: Date.now(),
            itemName,
            lastUpdated: new Date().toISOString()
        };

        prices[itemKey] = priceData;
        savePrices();
        return auctionPrice;
    } catch (error) {
        console.error('API Error:', error);
        return cachedPrice?.auction || null;
    }
}

async function fetchBazaarPrice(itemName) {
    try {
        const response = await fetch(`${API_BASE}/skyblock/bazaar?key=${apiKey}`);
        if (!response.ok) {
            console.error('Failed to fetch bazaar data:', response.status);
            return null;
        }

        const data = await response.json();
        if (!data.success || !data.products) {
            console.error('Failed to fetch bazaar data:', data.cause);
            return null;
        }

        const itemKey = getItemKey(itemName);
        let bazaarItem = null;

        for (const [productId, product] of Object.entries(data.products)) {
            if (product.product_id && (
                product.product_id.toLowerCase() === itemKey ||
                product.product_id.toLowerCase().replace(/_/g, ' ') === itemName.toLowerCase()
            )) {
                bazaarItem = product;
                break;
            }
        }

        if (!bazaarItem || !bazaarItem.quick_status) {
            console.log(`Item ${itemName} not found in bazaar`);
            return null;
        }

        const sellPrice = Math.round(bazaarItem.quick_status.sellPrice * 10) / 10;
        const buyPrice = Math.round(bazaarItem.quick_status.buyPrice * 10) / 10;

        console.log(`Found bazaar prices for ${itemName}: sell=${sellPrice}, buy=${buyPrice}`);
        
        return {
            sellPrice: sellPrice,
            buyPrice: buyPrice,
            source: 'bazaar'
        };
    } catch (error) {
        console.error('Error fetching bazaar price:', error);
        return null;
    }
}

// Add API key management
function showApiKeyDialog() {
    const key = prompt('Enter your Hypixel API key:', apiKey);
    if (key !== null) {
        apiKey = key;
        saveApiKey(key);
    }
}

// Rest of your existing functions...
function formatNumber(num) {
    if (num < 1000 && num % 1 !== 0) {
        return Math.round(num * 10) / 10;
    }
    
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return Math.round(num * 10) / 10;
}

function getItemKey(itemName) {
    return itemName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Include all your existing functions from app.js here...
// (renderPortfolio, addEntry, deleteEntry, etc.)

// Add API key button to init
async function init() {
    await loadData();

    // Add API key management
    const apiKeyBtn = document.createElement('button');
    apiKeyBtn.textContent = 'Set API Key';
    apiKeyBtn.style.marginLeft = '10px';
    document.querySelector('.portfolio-header').appendChild(apiKeyBtn);
    apiKeyBtn.addEventListener('click', showApiKeyDialog);

    // Rest of your existing init code...
}

init();
