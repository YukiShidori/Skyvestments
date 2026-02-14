const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const PRICES_FILE = path.join(DATA_DIR, 'prices.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const REPO_DIR = path.join(__dirname, 'NotEnoughUpdates-REPO');

function loadEntries() {
    try {
        const data = fs.readFileSync(ENTRIES_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return { entries: [] };
    }
}

function saveEntries(entries) {
    fs.writeFileSync(ENTRIES_FILE, JSON.stringify(entries, null, 2));
}

function loadPrices() {
    try {
        const data = fs.readFileSync(PRICES_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return { prices: {} };
    }
}

function savePrices(pricesData) {
    fs.writeFileSync(PRICES_FILE, JSON.stringify(pricesData, null, 2));
}

function loadConfig() {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return { apiKey: '' };
    }
}

function loadItems() {
    try {
        const data = fs.readFileSync(ITEMS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return { items: [], lastUpdated: 0 };
    }
}

function saveItems(itemsData) {
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(itemsData, null, 2));
}

async function fetchItemsFromAPI() {
    try {
        const itemsDir = path.join(REPO_DIR, 'items');

        if (!fs.existsSync(itemsDir)) {
            console.log('Cloning NEU repo...');
            await cloneRepo();
        }

        const files = fs.readdirSync(itemsDir).filter(f => f.endsWith('.json'));
        const items = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(itemsDir, file), 'utf8');
                const data = JSON.parse(content);
                if (data.displayname) {
                    const cleanName = data.displayname.replace(/§[0-9a-fk-or]/gi, '').trim();
                    items.push({
                        name: cleanName,
                        internalId: data.internalname || file.replace('.json', '')
                    });
                }
            } catch (e) {
                // Skip invalid files
            }
        }

        return items;
    } catch (error) {
        console.error('Error reading items:', error);
        return [];
    }
}

async function cloneRepo() {
    const { execSync } = require('child_process');

    if (fs.existsSync(REPO_DIR)) {
        execSync('cd ' + REPO_DIR + ' && git pull', { stdio: 'inherit' });
    } else {
        execSync('git clone https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO.git', {
            cwd: __dirname,
            stdio: 'inherit'
        });
    }
}

async function updateRepo() {
    if (fs.existsSync(REPO_DIR)) {
        const { execSync } = require('child_process');
        execSync('git pull', { cwd: REPO_DIR, stdio: 'inherit' });
        console.log('NEU repo updated');
    }
}

async function loadAndRefreshItems() {
    const items = await fetchItemsFromAPI();
    if (items && items.length > 0) {
        const itemNames = items.map(i => i.name).sort();
        saveItems({ items: itemNames, itemMap: items, lastUpdated: Date.now() });
        console.log(`Loaded ${items.length} items from NEU repo`);
    }
}

const PRICE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const ITEMS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for items

function getItemKey(itemName) {
    return itemName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function roundToTenth(num) {
    return Math.round(num * 10) / 10;
}

async function fetchBazaarPrice(itemName) {
    try {
        const response = await fetch(`https://api.hypixel.net/v2/skyblock/bazaar`);
        if (!response.ok) {
            console.error('Failed to fetch bazaar data:', response.status);
            return null;
        }

        const data = await response.json();
        if (!data.success || !data.products) {
            console.error('Failed to fetch bazaar data:', data.cause);
            return null;
        }

        // Find the item in bazaar by exact match only
        const itemKey = getItemKey(itemName);
        let bazaarItem = null;

        // Try to find exact match only
        for (const [productId, product] of Object.entries(data.products)) {
            if (product.product_id && (
                product.product_id.toLowerCase() === itemKey ||
                product.product_id.toLowerCase().replace(/_/g, ' ') === itemName.toLowerCase()
            )) {
                bazaarItem = product;
                break;
            }
        }

        // No partial matching - only exact matches allowed

        if (!bazaarItem || !bazaarItem.quick_status) {
            console.log(`Item ${itemName} not found in bazaar`);
            return null;
        }

        const sellPrice = roundToTenth(bazaarItem.quick_status.sellPrice); // What players sell to bazaar for
        const buyPrice = roundToTenth(bazaarItem.quick_status.buyPrice);   // What players buy from bazaar for

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

async function fetchLowestBin(apiKey, itemName) {
    const prices = loadPrices();
    const itemKey = getItemKey(itemName);
    const cachedPrice = prices.prices?.[itemKey];

    if (cachedPrice && cachedPrice.timestamp) {
        const age = Date.now() - cachedPrice.timestamp;
        if (age < PRICE_CACHE_DURATION) {
            return cachedPrice;
        }
    }

    try {
        const config = loadConfig();
        const apiKeyToUse = apiKey || config.apiKey;

        if (!apiKeyToUse) {
            console.log('No API key available for fetching auction data');
            return cachedPrice || null;
        }

        console.log(`Fetching auction price for: ${itemName}`);

        // Use the auction endpoint - we need to search through pages but with early termination
        let auctionPrice = null;
        let page = 0;
        const maxPages = 10; // Limit to first 10 pages for performance

        while (page < maxPages && auctionPrice === null) {
            const searchUrl = `https://api.hypixel.net/v2/skyblock/auctions?key=${apiKeyToUse}&page=${page}&limit=100`;

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

            // Find exact match only - no partial matches
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

            // No partial matching - only exact matches allowed

            // Debug: Log some sample items from this page
            if (page === 0) {
                console.log(`Page ${page} has ${data.auctions.length} auctions`);
                const sampleItems = data.auctions.slice(0, 5).map(a => a.item_name).join(', ');
                console.log(`Sample items: ${sampleItems}`);
            }

            page++;
        }

        // If no auction price found, try bazaar as fallback
        if (auctionPrice === null) {
            console.log(`No auction price found for ${itemName}, trying bazaar...`);
            const bazaarData = await fetchBazaarPrice(itemName);

            if (bazaarData) {
                const priceData = {
                    auction: bazaarData.sellPrice, // Use sell price as the "auction" price for consistency
                    bazaarSellPrice: bazaarData.sellPrice,
                    bazaarBuyPrice: bazaarData.buyPrice,
                    source: 'bazaar',
                    timestamp: Date.now(),
                    itemName,
                    lastUpdated: new Date().toISOString()
                };

                prices.prices = prices.prices || {};
                prices.prices[itemKey] = priceData;
                console.log(`Using bazaar price for ${itemName}:`, priceData);
                savePrices(prices);
                return priceData;
            }
        }

        const priceData = {
            auction: auctionPrice,
            source: 'auction',
            timestamp: Date.now(),
            itemName,
            lastUpdated: new Date().toISOString()
        };

        prices.prices = prices.prices || {};
        prices.prices[itemKey] = priceData;
        console.log(`Final price for ${itemName}:`, priceData);
        savePrices(prices);

        return priceData;
    } catch (error) {
        console.error('API Error:', error);
        return cachedPrice || null;
    }
}

async function fetchNpcPrice(internalId) {
    try {
        const itemFile = path.join(REPO_DIR, 'items', `${internalId}.json`);
        if (fs.existsSync(itemFile)) {
            const content = fs.readFileSync(itemFile, 'utf8');
            const data = JSON.parse(content);
            return data.npc_sell_price || null;
        }
        return null;
    } catch (error) {
        return null;
    }
}

app.get('/api/config', (req, res) => {
    res.json(loadConfig());
});

app.put('/api/config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.get('/api/entries', (req, res) => {
    res.json(loadEntries());
});

app.put('/api/entries', (req, res) => {
    saveEntries(req.body);
    res.json({ success: true });
});

app.get('/api/prices', (req, res) => {
    res.json(loadPrices());
});

app.put('/api/prices', (req, res) => {
    savePrices(req.body);
    res.json({ success: true });
});

app.get('/api/price/:itemName', async (req, res) => {
    const config = loadConfig();
    const apiKey = config.apiKey;
    const itemName = req.params.itemName;

    if (!apiKey) {
        return res.status(400).json({ error: 'API key required' });
    }

    const price = await fetchLowestBin(apiKey, itemName);
    res.json({ price });
});

app.post('/api/refresh-all', async (req, res) => {
    const config = loadConfig();
    const apiKey = config.apiKey;
    const entries = loadEntries();
    const prices = loadPrices();

    const uniqueItems = [...new Set(entries.entries.map(e => e.itemName))];
    const results = {};

    for (const itemName of uniqueItems) {
        const itemKey = getItemKey(itemName);
        const cachedPrice = prices.prices?.[itemKey];

        let price = cachedPrice?.price;
        const age = cachedPrice?.timestamp ? Date.now() - cachedPrice.timestamp : Infinity;

        if (age >= PRICE_CACHE_DURATION && apiKey) {
            price = await fetchLowestBin(apiKey, itemName);
        }

        results[itemName] = price;
    }

    res.json(results);
});

app.get('/api/items', (req, res) => {
    const itemsData = loadItems();
    res.json(itemsData);
});

app.post('/api/refresh-items', async (req, res) => {
    const itemsData = loadItems();
    const age = Date.now() - itemsData.lastUpdated;

    if (age < ITEMS_CACHE_DURATION) {
        return res.json({ items: itemsData.items, cached: true });
    }

    const items = await fetchItemsFromAPI();
    if (items) {
        saveItems({ items, lastUpdated: Date.now() });
        res.json({ items, cached: false });
    } else {
        res.json({ items: itemsData.items, cached: true });
    }
});

app.post('/api/update-repo', async (req, res) => {
    try {
        await updateRepo();
        const items = await fetchItemsFromAPI();
        if (items) {
            saveItems({ items, lastUpdated: Date.now() });
            res.json({ success: true, count: items.length });
        } else {
            res.json({ success: false, error: 'Failed to read items' });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

loadAndRefreshItems().catch(console.error);

app.listen(PORT, () => {
    console.log(`Skyvestments running at http://localhost:${PORT}`);
});
