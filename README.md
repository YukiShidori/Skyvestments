# Skyvestments - Hypixel Skyblock Investment Tracker

A modern portfolio tracker for Hypixel Skyblock investments with real-time price checking.

## Features

- **Real-time Price Checking**: Uses Hypixel API for current auction and bazaar prices
- **30-Minute Cache**: Optimized API calls with intelligent caching
- **Exact Item Matching**: 100% accurate item identification
- **Bazaar Fallback**: Automatic fallback to bazaar when auction prices unavailable
- **Import/Export**: Full control over your portfolio data
- **Responsive Design**: Works on desktop and mobile

## Live Demo

Deployed on GitHub Pages: https://yourusername.github.io/skyvestments/

## Setup

1. **Get API Key**: Get your Hypixel API key from [hypixel.net](https://hypixel.net/)
2. **Set API Key**: Click "Set API Key" button in the app
3. **Add Investments**: Start tracking your Skyblock investments

## Technology

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **API**: Hypixel Skyblock API (Auctions & Bazaar)
- **Storage**: LocalStorage for data persistence
- **Deployment**: GitHub Pages

## Features Explained

### Price Checking
- Primary: Auction House BIN prices
- Fallback: Bazaar instant sell/buy prices
- Cache: 30 minutes for optimal performance

### Data Management
- Import: Load portfolio from JSON file
- Export: Download portfolio as JSON
- Storage: Local browser storage

### Item Matching
- 100% exact name matching
- No partial matches or false positives
- Supports all Skyblock items

## License

MIT License - Feel free to use and modify
