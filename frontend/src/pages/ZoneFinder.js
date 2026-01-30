import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ZoneFinder.css';

// VERSION: 2.3.1 - Fixed symbol search error
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function ZoneFinder() {
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1w');
  const [zones, setZones] = useState([]);
  const [selectedZones, setSelectedZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [availableSymbols, setAvailableSymbols] = useState([]);
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [useDropdown, setUseDropdown] = useState(false); // Default to Search mode

  // Fetch available symbols on mount
  useEffect(() => {
    fetchAvailableSymbols();
  }, []);

  const fetchAvailableSymbols = async () => {
    setLoadingSymbols(true);
    try {
      // Fetch from Delta Exchange API directly
      const response = await axios.get('https://api.delta.exchange/v2/tickers', {
        timeout: 10000
      });
      
      if (response.data.success) {
        const symbols = response.data.result
          .map(ticker => ticker.symbol)
          .filter(s => s) // Remove null/undefined
          .sort(); // Sort alphabetically
        
        setAvailableSymbols(symbols);
        setStatus(`Loaded ${symbols.length} symbols`);
      }
    } catch (error) {
      console.error('Error fetching symbols:', error);
      setStatus('Failed to load symbols');
    } finally {
      setLoadingSymbols(false);
    }
  };

  const searchZones = async () => {
    console.log('searchZones called');
    console.log('useDropdown:', useDropdown);
    console.log('symbol:', symbol);
    console.log('searchInput:', searchInput);
    
    // Get symbol from appropriate source
    let symbolToSearch = '';
    if (useDropdown) {
      symbolToSearch = symbol || '';
    } else {
      symbolToSearch = searchInput || '';
    }
    
    console.log('symbolToSearch before trim:', symbolToSearch);
    
    // Trim and validate
    symbolToSearch = symbolToSearch.trim();
    
    console.log('symbolToSearch after trim:', symbolToSearch);
    
    if (!symbolToSearch) {
      setStatus('Please enter or select a symbol');
      alert('⚠️ Please enter or select a symbol first');
      return;
    }

    setLoading(true);
    setStatus(`Fetching ${timeframe.toUpperCase()} support zones...`);
    
    try {
      console.log('Sending request with symbol:', symbolToSearch.toUpperCase());
      
      const response = await axios.post(`${API_URL}/api/zones/search`, {
        symbol: symbolToSearch.toUpperCase(),
        timeframe: timeframe
      });
      
      if (response.data.success) {
        setZones(response.data.zones);
        setSelectedZones([]);
        
        const responseSymbol = response.data.symbol || symbolToSearch.toUpperCase();
        const responseTimeframe = response.data.timeframe || timeframe;
        const responseCount = response.data.count || 0;
        
        setStatus(`Found ${responseCount} support zones for ${responseSymbol} (${responseTimeframe.toUpperCase()})`);
        
        // Show success popup
        alert(`✅ Symbol Found!\n\n${responseSymbol}: ${responseCount} support zones found in ${responseTimeframe.toUpperCase()} timeframe`);
      }
    } catch (error) {
      console.error('Search error:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      setStatus(`Error: ${errorMsg}`);
      setZones([]);
      alert(`❌ Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleZone = (index) => {
    if (selectedZones.includes(index)) {
      setSelectedZones(selectedZones.filter(i => i !== index));
    } else {
      setSelectedZones([...selectedZones, index]);
    }
  };

  const selectAll = () => {
    setSelectedZones(zones.map((_, i) => i));
  };

  const clearAll = () => {
    setSelectedZones([]);
  };

  const pushToDb = async () => {
    if (selectedZones.length === 0) {
      alert('No zones selected');
      return;
    }

    // Get symbol from appropriate source
    let symbolToPush = '';
    if (useDropdown) {
      symbolToPush = symbol;
    } else {
      symbolToPush = searchInput;
    }
    
    // Trim and validate
    symbolToPush = symbolToPush ? symbolToPush.trim() : '';
    
    if (!symbolToPush) {
      alert('⚠️ Symbol is missing');
      return;
    }

    const confirmed = window.confirm(
      `Push ${selectedZones.length} zone(s) for ${symbolToPush.toUpperCase()} (${timeframe.toUpperCase()}) to MongoDB?\n\nLevels will be added to the scrip.`
    );
    
    if (!confirmed) return;

    setLoading(true);
    setStatus('Pushing to database...');

    try {
      const response = await axios.post(`${API_URL}/api/zones/push`, {
        symbol: symbolToPush.toUpperCase(),
        timeframe: timeframe,
        selected_indices: selectedZones,
        zones: zones
      });

      if (response.data.success) {
        setStatus(`✅ ${response.data.message}`);
        alert('✅ Successfully pushed to MongoDB!\n\nGo to Monitor page to view and track these levels.');
        clearAll();
      }
    } catch (error) {
      const errorMsg = error.response?.data?.detail || error.message;
      setStatus(`❌ Error: ${errorMsg}`);
      alert(`❌ Failed to push to MongoDB:\n${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const openDeltaExchange = () => {
    // Get symbol from appropriate source
    let symbolToOpen = '';
    if (useDropdown) {
      symbolToOpen = symbol;
    } else {
      symbolToOpen = searchInput;
    }
    
    // Trim and validate
    symbolToOpen = symbolToOpen ? symbolToOpen.trim() : '';
    
    if (!symbolToOpen) {
      alert('Please enter or select a symbol first');
      return;
    }

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

  return (
    <div className="zone-finder">
      <div className="container">
        <div className="header-card">
          <h1>📊 Support Zone Finder</h1>
          <p className="subtitle">Weekly Timeframe Analysis</p>
        </div>

        <div className="search-card">
          <div className="input-row">
            <div className="input-group symbol-input-group">
              <label>Select Symbol</label>
              
              <div className="symbol-mode-toggle">
                <button 
                  className={`mode-btn ${useDropdown ? 'active' : ''}`}
                  onClick={() => setUseDropdown(true)}
                >
                  📋 Dropdown
                </button>
                <button 
                  className={`mode-btn ${!useDropdown ? 'active' : ''}`}
                  onClick={() => setUseDropdown(false)}
                >
                  🔍 Search
                </button>
              </div>

              {useDropdown ? (
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="symbol-dropdown"
                  disabled={loadingSymbols}
                >
                  <option value="">-- Select a Symbol --</option>
                  {availableSymbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
                  placeholder="Enter symbol (e.g., BTCUSDT)"
                  className="symbol-search-input"
                  onKeyPress={(e) => e.key === 'Enter' && searchZones()}
                />
              )}
              
              {useDropdown && (
                <button 
                  onClick={fetchAvailableSymbols} 
                  disabled={loadingSymbols}
                  className="btn-refresh-symbols"
                >
                  {loadingSymbols ? '⏳' : '🔄'} Refresh List
                </button>
              )}
            </div>

            <div className="input-group">
              <label>Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="timeframe-dropdown"
              >
                <option value="1M">📆 Monthly (1M)</option>
                <option value="1w">📅 Weekly (1W)</option>
                <option value="1d">📊 Daily (1D)</option>
                <option value="4h">⏰ 4 Hour (4H)</option>
                <option value="1h">⏱️ 1 Hour (1H)</option>
              </select>
            </div>
          </div>

          <div className="search-row">
            <button 
              onClick={searchZones} 
              disabled={loading || (useDropdown ? !symbol : !searchInput.trim())}
              className="btn-primary"
            >
              {loading ? '⏳ Searching...' : '🔍 Find Support Zones'}
            </button>
            <button 
              onClick={openDeltaExchange}
              disabled={useDropdown ? !symbol : !searchInput.trim()}
              className="btn-delta"
            >
              📈 Open on Delta
            </button>
          </div>
          
          <p className="status">{status}</p>
        </div>

        {zones.length > 0 && (
          <div className="results-card">
            <div className="results-header">
              <div>
                <h2>Support Zones Found</h2>
                <span className="count">{zones.length} zones</span>
              </div>
              <div className="action-buttons">
                <button onClick={selectAll} className="btn-success">Select All</button>
                <button onClick={clearAll} className="btn-warning">Clear All</button>
                <button 
                  onClick={pushToDb} 
                  disabled={selectedZones.length === 0 || loading}
                  className="btn-purple"
                >
                  📤 Push to DB ({selectedZones.length})
                </button>
              </div>
            </div>

            <div className="zones-table">
              <div className="table-header">
                <div className="col-check">✓</div>
                <div className="col-price">TOP (Trigger)</div>
                <div className="col-price">BOTTOM</div>
                <div className="col-date">Date</div>
                <div className="col-rally">Rally</div>
                <div className="col-move">Move %</div>
              </div>
              
              {zones.map((zone, index) => (
                <div 
                  key={index} 
                  className={`table-row ${selectedZones.includes(index) ? 'selected' : ''}`}
                  onClick={() => toggleZone(index)}
                >
                  <div className="col-check">
                    {selectedZones.includes(index) ? '✓' : ''}
                  </div>
                  <div className="col-price">${zone.top.toFixed(2)}</div>
                  <div className="col-price">${zone.bottom.toFixed(2)}</div>
                  <div className="col-date">{zone.date}</div>
                  <div className="col-rally">{zone.rally_length}w</div>
                  <div className="col-move">{zone.total_move_pct.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ZoneFinder;
