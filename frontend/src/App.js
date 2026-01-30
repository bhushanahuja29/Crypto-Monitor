import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import ZoneFinder from './pages/ZoneFinder';
import Monitor from './pages/Monitor';
import './App.css';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function App() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [triggeredLevels, setTriggeredLevels] = useState([]);
  const [prices, setPrices] = useState({});

  // Fetch scrips and prices periodically
  useEffect(() => {
    const fetchTriggeredLevels = async () => {
      try {
        // Get all scrips
        const scripsResponse = await axios.get(`${API_URL}/api/scrips`);
        if (!scripsResponse.data.success) return;

        const scrips = scripsResponse.data.scrips;
        const triggered = [];
        const newPrices = {};

        // Fetch prices for all scrips
        for (const scrip of scrips) {
          try {
            const priceResponse = await axios.get(`${API_URL}/api/price/${scrip.symbol}`);
            if (priceResponse.data.success) {
              const currentPrice = priceResponse.data.mark_price;
              newPrices[scrip.symbol] = currentPrice;

              // Check each level
              scrip.trigger_levels?.forEach((level, idx) => {
                const isTriggered = currentPrice <= level.trigger_price;
                const alertEnabled = !level.alert_disabled;

                if (isTriggered && alertEnabled) {
                  triggered.push({
                    symbol: scrip.symbol,
                    levelIndex: idx + 1,
                    triggerPrice: level.trigger_price,
                    currentPrice: currentPrice,
                    timeframe: level.timeframe || '1w',
                    percentBelow: ((level.trigger_price - currentPrice) / level.trigger_price * 100).toFixed(2)
                  });
                }
              });
            }
          } catch (error) {
            console.error(`Error fetching price for ${scrip.symbol}:`, error);
          }
        }

        setTriggeredLevels(triggered);
        setPrices(newPrices);
      } catch (error) {
        console.error('Error fetching triggered levels:', error);
      }
    };

    // Fetch immediately
    fetchTriggeredLevels();

    // Then fetch every 5 seconds
    const interval = setInterval(fetchTriggeredLevels, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Router>
      <div className="App">
        <nav className="navbar">
          <div className="nav-container">
            <h1 className="nav-title">📊 Crypto Levels</h1>
            <div className="nav-links">
              <Link to="/" className="nav-link">Zone Finder</Link>
              <Link to="/monitor" className="nav-link">Monitor</Link>
              
              <div className="notification-wrapper">
                <button 
                  className="notification-bell"
                  onClick={() => setShowNotifications(!showNotifications)}
                >
                  🔔
                  {triggeredLevels.length > 0 && (
                    <span className="notification-badge">{triggeredLevels.length}</span>
                  )}
                </button>

                {showNotifications && (
                  <div className="notification-dropdown">
                    <div className="notification-header">
                      <h3>🔔 Triggered Alerts</h3>
                      <span className="notification-count">{triggeredLevels.length} active</span>
                    </div>
                    
                    {triggeredLevels.length === 0 ? (
                      <div className="notification-empty">
                        <p>✅ No triggered alerts</p>
                        <small>All levels are above current prices</small>
                      </div>
                    ) : (
                      <div className="notification-list">
                        {triggeredLevels.map((item, idx) => (
                          <Link 
                            key={idx}
                            to="/monitor"
                            className="notification-item"
                            onClick={() => setShowNotifications(false)}
                          >
                            <div className="notification-item-header">
                              <span className="notification-symbol">{item.symbol}</span>
                              <span className="notification-timeframe">{item.timeframe.toUpperCase()}</span>
                            </div>
                            <div className="notification-item-body">
                              <div className="notification-prices">
                                <span className="notification-label">Trigger:</span>
                                <span className="notification-value">${item.triggerPrice.toFixed(2)}</span>
                              </div>
                              <div className="notification-prices">
                                <span className="notification-label">Current:</span>
                                <span className="notification-value current">${item.currentPrice.toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="notification-item-footer">
                              <span className="notification-percent">↓ {item.percentBelow}% below trigger</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>
        
        <Routes>
          <Route path="/" element={<ZoneFinder />} />
          <Route path="/monitor" element={<Monitor />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
