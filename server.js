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
        const parsed = JSON.parse(data);
        return parsed;
    } catch {
        return { items: [], itemMap: [], lastUpdated: 0 };
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
    return itemName.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function mapToCoflnetTag(internalId) {
    // Handle special rune mapping
    if (internalId.includes('RUNE;')) {
        const runeMatch = internalId.match(/^([A-Z_]+)_RUNE;(\d+)$/);
        if (runeMatch) {
            const runeType = runeMatch[1];
            return `UNIQUE_RUNE_${runeType}`;
        }
    }

    // For all other items, return the internal ID as-is
    return internalId;
}

function roundToTenth(num) {
    return Math.round(num * 10) / 10;
}

async function fetchBazaarPrice(itemName) {
    try {
        // Use Coflnet API for bazaar data
        const itemsData = loadItems();
        const itemMap = itemsData.itemMap || [];
        const itemInfo = itemMap.find(item => item.name === itemName);

        if (!itemInfo) {
            console.log(`Item ${itemName} not found in item map for bazaar lookup`);
            return null;
        }

        const itemTag = mapToCoflnetTag(itemInfo.internalId);
        const response = await fetch(`https://sky.coflnet.com/api/bazaar/${itemTag}/snapshot`);

        if (!response.ok) {
            console.error('Failed to fetch Coflnet bazaar data:', response.status);
            return null;
        }

        const data = await response.json();

        if (!data || !data.productId) {
            console.log(`Item ${itemName} not found in Coflnet bazaar`);
            return null;
        }

        console.log(`Found Coflnet bazaar prices for ${itemName}: buy=${data.buyPrice}, sell=${data.sellPrice}`);

        return {
            sellPrice: roundToTenth(data.sellPrice), // What players sell to bazaar for
            buyPrice: roundToTenth(data.buyPrice),   // What players buy from bazaar for
            source: 'bazaar'
        };
    } catch (error) {
        console.error('Error fetching Coflnet bazaar price:', error);
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
        console.log(`Fetching auction price for: ${itemName}`);

        // Use Coflnet API endpoint
        const itemsData = loadItems();
        const itemMap = itemsData.itemMap || [];
        const itemInfo = itemMap.find(item => item.name === itemName);

        if (!itemInfo) {
            console.log(`Item ${itemName} not found in item map`);
            return cachedPrice || null;
        }

        const itemTag = mapToCoflnetTag(itemInfo.internalId);

        // Try both RUNE_ and UNIQUE_RUNE_ prefixes for runes
        let coflnetUrl = `https://sky.coflnet.com/api/auctions/tag/${itemTag}/active/bin`;
        let data = null;

        try {
            const response = await fetch(coflnetUrl);
            if (response.ok) {
                data = await response.json();
            }
        } catch (error) {
            console.log(`Failed to fetch ${itemTag}, trying alternative...`);
        }

        // If first attempt failed and it's a rune with UNIQUE_RUNE_ prefix, try RUNE_ prefix
        if (!data || data.length === 0) {
            if (itemTag.startsWith('UNIQUE_RUNE_')) {
                const alternativeTag = itemTag.replace('UNIQUE_RUNE_', 'RUNE_');
                coflnetUrl = `https://sky.coflnet.com/api/auctions/tag/${alternativeTag}/active/bin`;
                try {
                    const response = await fetch(coflnetUrl);
                    if (response.ok) {
                        data = await response.json();
                        if (data && data.length > 0) {
                            console.log(`Successfully used alternative tag: ${alternativeTag}`);
                        }
                    }
                } catch (error) {
                    console.log(`Alternative tag ${alternativeTag} also failed`);
                }
            }
        }

        // Find the lowest price from the active BIN auctions
        let lowestPrice = null;
        if (data && data.length > 0) {
            const validAuctions = data.filter(auction =>
                auction &&
                auction.startingBid &&
                auction.startingBid > 0
            );

            if (validAuctions.length > 0) {
                lowestPrice = Math.min(...validAuctions.map(a => a.startingBid));
            }
        }

        // If no auction price found, try bazaar as fallback
        if (lowestPrice === null) {
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

        // If still no price found and it's a rune, try NPC price
        if (lowestPrice === null && itemName.includes('◆')) {
            console.log(`No auction/bazaar price found for rune ${itemName}, trying NPC price...`);

            if (itemInfo) {
                const npcPrice = await fetchNpcPrice(itemInfo.internalId);
                if (npcPrice && npcPrice > 0) {
                    const priceData = {
                        auction: npcPrice,
                        source: 'npc',
                        timestamp: Date.now(),
                        itemName,
                        lastUpdated: new Date().toISOString()
                    };

                    prices.prices = prices.prices || {};
                    prices.prices[itemKey] = priceData;
                    console.log(`Using NPC price for ${itemName}:`, priceData);
                    savePrices(prices);
                    return priceData;
                }
            }
        }

        const priceData = {
            auction: lowestPrice,
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
    const itemName = req.params.itemName;

    const price = await fetchLowestBin(null, itemName);
    res.json({ price });
});

app.post('/api/refresh-all', async (req, res) => {
    const entries = loadEntries();
    const prices = loadPrices();

    const uniqueItems = [...new Set(entries.entries.map(e => e.itemName))];
    const results = {};

    for (const itemName of uniqueItems) {
        const itemKey = getItemKey(itemName);
        const cachedPrice = prices.prices?.[itemKey];

        let price = cachedPrice?.price;
        const age = cachedPrice?.timestamp ? Date.now() - cachedPrice.timestamp : Infinity;

        if (age >= PRICE_CACHE_DURATION) {
            price = await fetchLowestBin(null, itemName);
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
