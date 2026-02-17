# Skyvestments

**Live Demo**: https://skyvestments.onrender.com/

Skyvestments is a Hypixel Skyblock investment portfolio tracker that helps you manage and track your item investments.

## Features

- **Portfolio Management**: Add, view, and delete item investments
- **Real-time Price Tracking**: Automatically fetches current market prices from Coflnet API
- **Profit/Loss Calculation**: Shows your investment performance with current market values
- **Dark Mode Support**: Toggle between light and dark themes
- **Import/Export**: Save and load your portfolio data
- **Price History**: View recent price updates and sources

## How It Works

1. **Add Items**: Enter items you own with purchase price and quantity
2. **Price Updates**: Automatically fetches current market prices from Coflnet
3. **Track Performance**: See your total investment value and profit/loss
4. **Data Management**: Import/export your portfolio for backup

## Price Sources

- **Auction Data**: Uses Coflnet API for active BIN auctions
- **Bazaar Data**: Uses Coflnet API for current bazaar prices
- **Fallback System**: Automatically tries multiple sources for accurate pricing

## Getting Started

1. Clone this repository
2. Install dependencies with `npm install`
3. Run the server with `npm start`
4. Open http://localhost:3000 in your browser
5. Add your items and start tracking!

## Technologies

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **APIs**: Coflnet Skyblock API
- **Data Storage**: JSON files for simplicity
