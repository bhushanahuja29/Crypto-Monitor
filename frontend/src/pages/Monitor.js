import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './Monitor.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function Monitor() {
  const [scrips, setScrips] = useState([]);
  const [selectedScrip, setSelectedScrip] = useState(null);
  const [prices, setPrices] = useState({}); // Store prices for all scrips
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState({});
  const [toast, setToast] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState('default');
  const [timeframeFilter, setTimeframeFilter] = useState('all');

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        setNotificationPermission('granted');
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          setNotificationPermission(permission);
        });
      }
    }
  }, []);

  const sendNotification = useCallback((title, body, icon = '🔔') => {
    if (notificationPermission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: 'crypto-alert',
          requireInteraction: true
        });
      } catch (error) {
        console.error('Notification error:', error);
      }
    }
  }, [notificationPermission]);

  const openDeltaExchange = (symbolToOpen) => {
    if (!symbolToOpen) return;
    
    const upperSymbol = symbolToOpen.toUpperCase();
    
    // Extract base symbol (remove USD/USDT suffix)
    let baseSymbol = upperSymbol;
    if (upperSymbol.endsWith('USDT')) {
      baseSymbol = upperSymbol.slice(0, -4);
    } else if (upperSymbol.endsWith('USD')) {
      baseSymbol = upperSymbol.slice(0, -3);
    }
    
    // Build Delta Exchange URL
    const url = `https://www.delta.exchange/app/futures/trade/${baseSymbol}/${upperSymbol}`;
    
    window.open(url, '_blank');
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadScrips = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/scrips`);
      if (response.data.success) {
        setScrips(response.data.scrips);
        if (response.data.scrips.length > 0 && !selectedScrip) {
          setSelectedScrip(response.data.scrips[0]);
        }
      }
    } catch (error) {
      console.error('Error loading scrips:', error);
      showToast('Failed to load scrips', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedScrip]);

  const fetchPriceForSymbol = async (symbol) => {
    try {
      const response = await axios.get(`${API_URL}/api/price/${symbol}`);
      if (response.data.success) {
        return response.data.mark_price;
      }
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
    }
    return null;
  };

  const fetchAllPrices = useCallback(async () => {
    if (scrips.length === 0) return;

    const newPrices = {};
    const newLastUpdate = {};
    
    // Fetch prices for all scrips in parallel
    await Promise.all(
      scrips.map(async (scrip) => {
        const price = await fetchPriceForSymbol(scrip.symbol);
        if (price !== null) {
          newPrices[scrip.symbol] = price;
          newLastUpdate[scrip.symbol] = new Date().toLocaleTimeString();
          
          // Check for triggered levels and send notifications
          scrip.trigger_levels?.forEach((level, idx) => {
            const wasTriggered = level.triggered || false;
            const isNowTriggered = price <= level.trigger_price;
            const alertEnabled = !level.alert_disabled;
            
            // Send notification on new trigger
            if (!wasTriggered && isNowTriggered && alertEnabled) {
              const timeframeLabel = level.timeframe ? level.timeframe.toUpperCase() : 'UNKNOWN';
              sendNotification(
                `🔔 ${scrip.symbol} Alert Triggered!`,
                `${timeframeLabel} Level: $${level.trigger_price.toFixed(2)}\nCurrent: $${price.toFixed(2)}`,
                '🔔'
              );
            }
          });
        }
      })
    );

    setPrices(newPrices);
    setLastUpdate(newLastUpdate);
  }, [scrips, sendNotification]);

  const toggleAlert = async (levelIndex) => {
    if (!selectedScrip) return;

    // Get current status from the level data
    const currentLevel = selectedScrip.trigger_levels[levelIndex];
    const currentlyDisabled = currentLevel.alert_disabled || false;
    const newDisabledStatus = !currentlyDisabled; // Toggle it
    
    console.log(`Toggling level ${levelIndex}: currently disabled=${currentlyDisabled}, new disabled=${newDisabledStatus}`);
    
    try {
      // Update database
      const response = await axios.put(`${API_URL}/api/scrips/${selectedScrip.symbol}/alert`, {
        symbol: selectedScrip.symbol,
        level_index: levelIndex,
        disabled: newDisabledStatus
      });

      if (response.data.success) {
        console.log('Database updated successfully');
        
        // Update local state immediately
        const updatedScrips = scrips.map(scrip => {
          if (scrip.symbol === selectedScrip.symbol) {
            const updatedLevels = scrip.trigger_levels.map((level, idx) => {
              if (idx === levelIndex) {
                return {
                  ...level,
                  alert_disabled: newDisabledStatus
                };
              }
              return level;
            });
            return { ...scrip, trigger_levels: updatedLevels };
          }
          return scrip;
        });

        setScrips(updatedScrips);
        
        // Update selected scrip
        const updatedSelectedScrip = updatedScrips.find(s => s.symbol === selectedScrip.symbol);
        setSelectedScrip(updatedSelectedScrip);

        // Show toast notification
        const statusText = newDisabledStatus ? 'disabled' : 'enabled';
        showToast(`Level ${levelIndex + 1} alert ${statusText}`, 'success');
        
        console.log(`UI updated: alert_disabled=${newDisabledStatus}`);
      }
    } catch (error) {
      console.error('Error toggling alert:', error);
      showToast('Failed to update alert status', 'error');
    }
  };

  // Load scrips on mount
  useEffect(() => {
    loadScrips();
  }, [loadScrips]);

  // Auto-start monitoring all scrips
  useEffect(() => {
    if (scrips.length === 0) return;

    console.log(`🚀 Auto-monitoring ${scrips.length} scrip(s) in background...`);
    
    // Fetch prices immediately
    fetchAllPrices();
    
    // Set up interval to fetch prices every 3 seconds
    const interval = setInterval(fetchAllPrices, 3000);
    
    return () => clearInterval(interval);
  }, [scrips, fetchAllPrices]);

  const calculateDistance = (currentPrice, triggerPrice) => {
    if (!currentPrice || !triggerPrice) return null;
    
    if (currentPrice >= triggerPrice) {
      const percentage = ((currentPrice - triggerPrice) / triggerPrice) * 100;
      return {
        percentage,
        triggered: false,
        text: `${percentage.toFixed(1)}% above`,
        color: percentage > 10 ? '#4CAF50' : percentage > 5 ? '#FF9800' : '#F44336'
      };
    } else {
      const percentageBelow = ((triggerPrice - currentPrice) / triggerPrice) * 100;
      return {
        percentage: -1,
        triggered: true,
        text: `🔔 TRIGGERED (${percentageBelow.toFixed(1)}% below)`,
        color: '#F44336'
      };
    }
  };

  const currentPrice = selectedScrip ? prices[selectedScrip.symbol] : null;

  // Filter levels by timeframe
  const filteredLevels = selectedScrip?.trigger_levels ? 
    selectedScrip.trigger_levels.filter(level => 
      timeframeFilter === 'all' || level.timeframe === timeframeFilter
    ) : [];

  const sortedLevels = filteredLevels.length > 0 ? 
    [...filteredLevels]
      .map((level, index) => {
        // Find original index in full array
        const originalIndex = selectedScrip.trigger_levels.findIndex(l => l === level);
        return { ...level, originalIndex };
      })
      .sort((a, b) => {
        if (!currentPrice) return a.trigger_price - b.trigger_price;
        
        const distA = calculateDistance(currentPrice, a.trigger_price);
        const distB = calculateDistance(currentPrice, b.trigger_price);
        
        if (distA.triggered && !distB.triggered) return -1;
        if (!distA.triggered && distB.triggered) return 1;
        
        return distA.percentage - distB.percentage;
      })
    : [];

  // Get unique timeframes for filter
  const availableTimeframes = selectedScrip?.trigger_levels ? 
    [...new Set(selectedScrip.trigger_levels.map(l => l.timeframe || '1w'))].sort((a, b) => {
      // Sort order: 1M, 1w, 1d, 4h, 1h
      const order = { '1M': 0, '1w': 1, '1d': 2, '4h': 3, '1h': 4 };
      return (order[a] || 99) - (order[b] || 99);
    }) : [];

  if (loading) {
    return (
      <div className="monitor">
        <div className="container">
          <div className="loading">Loading scrips...</div>
        </div>
      </div>
    );
  }

  if (scrips.length === 0) {
    return (
      <div className="monitor">
        <div className="container">
          <div className="empty-state">
            <h2>No Scrips Found</h2>
            <p>Go to Zone Finder to add support levels</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="monitor">
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.message}
        </div>
      )}
      
      <div className="container">
        <div className="monitoring-status">
          <span className="status-badge active">
            ● Auto-Monitoring {scrips.length} Scrip(s)
          </span>
          <span className="update-info">
            Updates every 3 seconds
          </span>
        </div>

        <div className="tabs">
          {scrips.map((scrip) => {
            const scripPrice = prices[scrip.symbol];
            const hasTriggered = scrip.trigger_levels?.some(level => 
              scripPrice && scripPrice <= level.trigger_price && !level.alert_disabled
            );
            
            return (
              <button
                key={scrip.symbol}
                className={`tab ${selectedScrip?.symbol === scrip.symbol ? 'active' : ''} ${hasTriggered ? 'triggered' : ''}`}
                onClick={() => setSelectedScrip(scrip)}
              >
                {hasTriggered && '🔔 '}
                {scrip.symbol} ({scrip.trigger_levels?.length || 0})
              </button>
            );
          })}
          <button className="refresh-btn" onClick={loadScrips}>
            🔄 Refresh
          </button>
        </div>

        {selectedScrip && (
          <div className="monitor-content">
            <div className="header-section">
              <div className="header-top">
                <div>
                  <h1>Symbol: {selectedScrip.symbol}</h1>
                  <p className="level-count">{selectedScrip.trigger_levels?.length || 0} Support Levels</p>
                </div>
                <button 
                  className="btn-open-delta"
                  onClick={() => openDeltaExchange(selectedScrip.symbol)}
                >
                  📈 Open on Delta
                </button>
              </div>
              
              {notificationPermission !== 'granted' && (
                <div className="notification-banner">
                  <span>🔔 Enable notifications to receive alerts</span>
                  <button onClick={() => Notification.requestPermission().then(p => setNotificationPermission(p))}>
                    Enable
                  </button>
                </div>
              )}
              
              <div className="price-display">
                <p className="price-label">Current Mark Price</p>
                <h2 className="current-price">
                  {currentPrice ? `${currentPrice.toFixed(4)}` : '--'}
                </h2>
              </div>

              <div className="status-row">
                <span className="status active">
                  ● Monitoring all levels
                </span>
                <span className="update-time">
                  {lastUpdate[selectedScrip.symbol] || '--:--:--'}
                </span>
              </div>
            </div>

            <div className="levels-section">
              <div className="levels-header">
                <h2>Support Levels (sorted by distance)</h2>
                <div className="timeframe-filter">
                  <label>Filter:</label>
                  <select 
                    value={timeframeFilter} 
                    onChange={(e) => setTimeframeFilter(e.target.value)}
                    className="filter-dropdown"
                  >
                    <option value="all">All ({selectedScrip.trigger_levels?.length || 0})</option>
                    {availableTimeframes.map(tf => (
                      <option key={tf} value={tf}>
                        {tf.toUpperCase()} ({selectedScrip.trigger_levels.filter(l => l.timeframe === tf).length})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="levels-list">
                {sortedLevels.map((level) => {
                  const distance = calculateDistance(currentPrice, level.trigger_price);
                  const alertEnabled = !level.alert_disabled;
                  const timeframeLabel = level.timeframe ? level.timeframe.toUpperCase() : '1W';
                  
                  return (
                    <div 
                      key={level.originalIndex} 
                      className={`level-card ${distance?.triggered ? 'triggered' : ''}`}
                    >
                      <div className="level-info">
                        <div className="level-header">
                          <span className="level-number">Level {level.originalIndex + 1}</span>
                          <span className="timeframe-badge">{timeframeLabel}</span>
                          {distance && (
                            <span className="distance-badge" style={{ color: distance.color }}>
                              ↓ {distance.text}
                            </span>
                          )}
                        </div>
                        <div className="level-price">${level.trigger_price.toFixed(2)}</div>
                        <div className="level-details">
                          Bottom: ${level.bottom.toFixed(2)} | Rally: {level.rally_length}w | Move: {level.total_move_pct.toFixed(1)}%
                        </div>
                      </div>

                      <div className="level-controls">
                        <div className="progress-bar">
                          <div 
                            className="progress-fill"
                            style={{
                              width: distance ? 
                                (distance.triggered ? '100%' : `${Math.max(0, 100 - distance.percentage)}%`) 
                                : '0%',
                              backgroundColor: distance?.color || '#E0E0E0'
                            }}
                          />
                        </div>
                        
                        <button
                          className={`alert-toggle ${alertEnabled ? 'enabled' : 'disabled'}`}
                          onClick={() => toggleAlert(level.originalIndex)}
                        >
                          {alertEnabled ? '🔔 Alert ON' : '🔕 Alert OFF'}
                        </button>
                        
                        <span 
                          className="status-indicator"
                          style={{ color: distance?.color || '#999' }}
                        >
                          ●
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Monitor;
