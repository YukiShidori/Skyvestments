const API_BASE = '/api';
const PRICE_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds

let entries = [];
let prices = {};
let apiKey = '';
let allItems = [];

// Dark mode functionality
function initDarkMode() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', toggleDarkMode);
    }
}

function toggleDarkMode() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

async function loadData() {
    try {
        const configResponse = await fetch('/api/config');
        const configData = await configResponse.json();
        apiKey = configData.apiKey || '';

        const entriesResponse = await fetch('/api/entries');
        const entriesData = await entriesResponse.json();
        entries = entriesData.entries || [];

        const pricesResponse = await fetch('/api/prices');
        const pricesData = await pricesResponse.json();
        prices = pricesData.prices || {};
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

async function saveEntries() {
    try {
        const response = await fetch('/api/entries', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries }, null, 2)
        });
    } catch (error) {
        console.error('Error saving entries:', error);
    }
}

async function savePrices() {
    try {
        const response = await fetch('/api/prices', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prices }, null, 2)
        });
    } catch (error) {
        console.error('Error saving prices:', error);
    }
}

function formatNumber(num) {
    // Round to nearest tenth for decimal numbers
    if (num < 1000 && num % 1 !== 0) {
        return Math.round(num * 10) / 10;
    }

    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return Math.round(num * 10) / 10;
}

function getItemKey(itemName) {
    return itemName.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function getGroupedPurchases(itemName) {
    const grouped = {};
    entries
        .filter(e => e.itemName.toLowerCase() === itemName.toLowerCase())
        .forEach(entry => {
            const key = entry.buyPrice;
            if (!grouped[key]) {
                grouped[key] = { price: entry.buyPrice, quantity: 0 };
            }
            grouped[key].quantity += entry.quantity;
        });
    return Object.values(grouped);
}

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

    try {
        const response = await fetch(`${API_BASE}/price/${encodeURIComponent(itemName)}`);
        const data = await response.json();

        if (data.price !== null) {
            prices[itemKey] = {
                auction: data.price.auction,
                timestamp: data.price.timestamp,
                itemName: itemName,
                lastUpdated: data.price.lastUpdated
            };
            await savePrices();
            console.log(`Fetched new price for ${itemName}: ${data.price.auction}`);
            return data.price.auction;
        }

        return cachedPrice?.auction || null;
    } catch (error) {
        console.error('Error fetching price:', error);
        return cachedPrice?.auction || null;
    }
}

async function refreshAllPrices() {
    const uniqueItems = [...new Set(entries.map(e => e.itemName))];

    for (const itemName of uniqueItems) {
        await fetchLowestBin(itemName);
    }
}

function renderPortfolio() {
    const tbody = document.getElementById('portfolioBody');
    tbody.innerHTML = '';

    const groupedEntries = {};
    entries.forEach(entry => {
        const key = entry.itemName.toLowerCase();
        if (!groupedEntries[key]) {
            groupedEntries[key] = {
                itemName: entry.itemName,
                totalQuantity: 0,
                totalInvested: 0,
                purchases: []
            };
        }
        groupedEntries[key].totalQuantity += entry.quantity;
        groupedEntries[key].totalInvested += entry.buyPrice * entry.quantity;
        groupedEntries[key].purchases.push({
            price: entry.buyPrice,
            quantity: entry.quantity
        });
    });

    let totalInvested = 0;
    let totalCurrentValue = 0;

    Object.values(groupedEntries).forEach(group => {
        const avgBuyPrice = group.totalInvested / group.totalQuantity;
        const itemKey = getItemKey(group.itemName);
        console.log(`Looking for price for ${group.itemName} with key ${itemKey}`);
        const priceData = prices[itemKey];
        console.log(`Found price data:`, priceData);

        const auctionPrice = priceData?.auction || null;

        const currentPrice = auctionPrice;
        const currentValue = currentPrice ? currentPrice * group.totalQuantity : 0;
        const profitLoss = currentValue - group.totalInvested;

        totalInvested += group.totalInvested;
        totalCurrentValue += currentValue;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${group.itemName}</td>
            <td>${group.totalQuantity}</td>
            <td>${formatNumber(avgBuyPrice)}</td>
            <td class="total-bought" data-item="${group.itemName}">
                ${formatNumber(group.totalInvested)}
            </td>
            <td class="current-value" data-item="${group.itemName}">
                ${currentPrice ? formatNumber(currentValue) : '<span class="loading">Loading...</span>'}
            </td>
            <td class="${profitLoss >= 0 ? 'positive' : 'negative'}">
                ${profitLoss >= 0 ? '+' : ''}${formatNumber(profitLoss)}
            </td>
            <td>
                <button class="delete-btn" data-item="${group.itemName}">Delete All</button>
            </td>
        `;

        const totalBoughtCell = tr.querySelector('.total-bought');
        totalBoughtCell.addEventListener('mouseenter', (e) => showTooltip(e, group.itemName));
        totalBoughtCell.addEventListener('mouseleave', hideTooltip);
        totalBoughtCell.addEventListener('mousemove', moveTooltip);

        const currentValueCell = tr.querySelector('.current-value');
        currentValueCell.addEventListener('mouseenter', (e) => showPriceTooltip(e, group.itemName));
        currentValueCell.addEventListener('mouseleave', hideTooltip);
        currentValueCell.addEventListener('mousemove', moveTooltip);

        const deleteBtn = tr.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => deleteItem(group.itemName));

        tbody.appendChild(tr);
    });

    document.getElementById('totalInvested').textContent = formatNumber(totalInvested) + ' coins';
    document.getElementById('currentValue').textContent = formatNumber(totalCurrentValue) + ' coins';

    const profitLossEl = document.getElementById('profitLoss');
    const profitLoss = totalCurrentValue - totalInvested;
    profitLossEl.textContent = (profitLoss >= 0 ? '+' : '') + formatNumber(profitLoss) + ' coins';
    profitLossEl.className = 'value ' + (profitLoss >= 0 ? 'positive' : 'negative');

    attachTooltipHandlers();
}

function showTooltip(e, itemName) {
    const tooltip = document.getElementById('tooltip');
    const grouped = getGroupedPurchases(itemName);

    let content = `<div class="tooltip-title">${itemName} - Purchase History</div>`;
    grouped.forEach(group => {
        content += `<div class="tooltip-entry">${group.quantity}x @ ${formatNumber(group.price)} coins</div>`;
    });

    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    moveTooltip(e);
}

function showPriceTooltip(e, itemName) {
    const tooltip = document.getElementById('tooltip');
    const itemKey = getItemKey(itemName);
    const priceData = prices[itemKey];

    let content = `<div class="tooltip-title">${itemName} - Current Price</div>`;

    if (priceData?.auction) {
        const source = priceData.source || 'auction';
        let sourceLabel = 'Auction (BIN)';

        if (source === 'bazaar') {
            sourceLabel = 'Bazaar Sell Price';
        } else if (source === 'npc') {
            sourceLabel = 'NPC Sell Price';
        }

        content += `<div class="tooltip-entry">${sourceLabel}: ${formatNumber(priceData.auction)}</div>`;

        if (source === 'bazaar' && priceData.bazaarBuyPrice) {
            content += `<div class="tooltip-entry">Bazaar Buy Price: ${formatNumber(priceData.bazaarBuyPrice)}</div>`;
        }

        content += `<div class="tooltip-entry"><small>Source: ${source}</small></div>`;
    }

    if (!priceData?.auction) {
        content += `<div class="tooltip-entry">Loading price...</div>`;
    }

    tooltip.innerHTML = content;
    tooltip.classList.add('visible');
    moveTooltip(e);
}

function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.classList.remove('visible');
}

function moveTooltip(e) {
    const tooltip = document.getElementById('tooltip');
    tooltip.style.left = e.clientX + 15 + 'px';
    tooltip.style.top = e.clientY + 15 + 'px';
}

function attachTooltipHandlers() {
    document.querySelectorAll('.total-bought').forEach(cell => {
        cell.addEventListener('mouseenter', (e) => {
            const itemName = e.target.dataset.item;
            showTooltip(e, itemName);
        });
        cell.addEventListener('mouseleave', hideTooltip);
        cell.addEventListener('mousemove', moveTooltip);
    });

    document.querySelectorAll('.current-value').forEach(cell => {
        cell.addEventListener('mouseenter', (e) => {
            const itemName = e.target.dataset.item;
            showPriceTooltip(e, itemName);
        });
        cell.addEventListener('mouseleave', hideTooltip);
        cell.addEventListener('mousemove', moveTooltip);
    });
}

async function deleteItem(itemName) {
    if (confirm(`Delete all entries for "${itemName}"?`)) {
        entries = entries.filter(e => e.itemName.toLowerCase() !== itemName.toLowerCase());
        // Removed automatic save - entries now managed via import/export
        renderPortfolio();
    }
}

async function addEntry(itemName, buyPrice, quantity) {
    entries.push({
        id: Date.now(),
        itemName,
        buyPrice: parseFloat(buyPrice),
        quantity: parseInt(quantity),
        timestamp: Date.now()
    });
    // Removed automatic save - entries now managed via import/export
    await fetchLowestBin(itemName);
    renderPortfolio();
}

async function loadItems() {
    try {
        const response = await fetch('/api/items');
        const data = await response.json();
        allItems = data.items || [];
    } catch (error) {
        console.error('Error loading items:', error);
    }
}

async function refreshItems() {
    try {
        const response = await fetch('/api/refresh-items', { method: 'POST' });
        const data = await response.json();
        allItems = data.items || [];
    } catch (error) {
        console.error('Error refreshing items:', error);
    }
}

function showAutocomplete(query) {
    const dropdown = document.getElementById('autocompleteDropdown');

    if (!query || allItems.length === 0) {
        dropdown.classList.remove('visible');
        return;
    }

    const filtered = allItems.filter(item =>
        item.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (filtered.length === 0) {
        dropdown.classList.remove('visible');
        return;
    }

    dropdown.innerHTML = filtered.map(item =>
        `<div class="autocomplete-item" data-value="${item}">${item}</div>`
    ).join('');

    dropdown.classList.add('visible');

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('itemName').value = item.dataset.value;
            dropdown.classList.remove('visible');
        });
    });
}

function hideAutocomplete() {
    setTimeout(() => {
        document.getElementById('autocompleteDropdown').classList.remove('visible');
    }, 200);
}

function renderPriceLog() {
    const logContainer = document.getElementById('priceLog');
    logContainer.innerHTML = '';

    const priceEntries = Object.entries(prices || {})
        .filter(([key, data]) => data && data.timestamp)
        .sort((a, b) => b[1].timestamp - a[1].timestamp);

    if (priceEntries.length === 0) {
        logContainer.innerHTML = '<p class="loading">No price data yet. Add items and an API key to fetch prices.</p>';
        return;
    }

    priceEntries.forEach(([key, data]) => {
        const div = document.createElement('div');
        div.className = 'price-log-item';
        const date = new Date(data.timestamp).toLocaleString();
        const source = data.source || 'auction';
        const sourceLabel = source === 'bazaar' ? 'Bazaar' : 'Auction';
        div.innerHTML = `
            <span class="item-name">${data.itemName || key}</span>
            <span class="price-info">
                ${formatNumber(data.auction)} coins
                <br><small>${sourceLabel} • ${date}</small>
            </span>
        `;
        logContainer.appendChild(div);
    });
}

function exportEntries() {
    const dataStr = JSON.stringify({ entries }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skyvestments-entries-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function importEntries(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.entries && Array.isArray(data.entries)) {
                entries = data.entries;
                renderPortfolio();
                alert(`Successfully imported ${entries.length} entries`);
            } else {
                alert('Invalid file format. Please select a valid entries.json file.');
            }
        } catch (error) {
            alert('Error reading file: ' + error.message);
        }
    };
    reader.readAsText(file);
}

async function init() {
    // Initialize dark mode first
    initDarkMode();

    await loadData();

    document.getElementById('entryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemName = document.getElementById('itemName').value;
        const buyPrice = document.getElementById('buyPrice').value;
        const quantity = document.getElementById('quantity').value;
        await addEntry(itemName, buyPrice, quantity);
        document.getElementById('entryForm').reset();
    });

    document.getElementById('refreshBtn').addEventListener('click', async () => {
        const btn = document.getElementById('refreshBtn');
        btn.textContent = 'Refreshing...';
        await refreshAllPrices();
        renderPortfolio();
        btn.textContent = 'Refresh Prices';
    });

    document.getElementById('exportBtn').addEventListener('click', exportEntries);

    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    document.getElementById('importFile').addEventListener('change', importEntries);

    const itemNameInput = document.getElementById('itemName');
    itemNameInput.addEventListener('input', (e) => showAutocomplete(e.target.value));
    itemNameInput.addEventListener('focus', (e) => showAutocomplete(e.target.value));
    itemNameInput.addEventListener('blur', hideAutocomplete);

    await loadItems();
    if (allItems.length === 0) {
        await refreshItems();
    }

    if (entries.length > 0) {
        await refreshAllPrices();
    }

    renderPortfolio();

    setInterval(async () => {
        await refreshAllPrices();
        renderPortfolio();
    }, PRICE_CACHE_DURATION);
}

init();
