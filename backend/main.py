"""
FastAPI Backend for Crypto Levels Bhushan
Provides APIs for support zone finding and monitoring
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import sys
from datetime import datetime
from pymongo import MongoClient
import requests
from pathlib import Path

# Add parent directory to path to import v3
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

# Import v3 functions
from v3 import compute_zones_for_symbol, ts_str

app = FastAPI(title="Crypto Levels API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB Configuration
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb+srv://Bhushan:BhushanDelta@deltapricetracker.y0ipzbf.mongodb.net/?appName=DeltaPriceTracker")
DB_NAME = os.getenv("DB_NAME", "delta_tracker")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "monitored_scrips")

# MongoDB client
mongo_client = None
db = None
collection = None

def get_mongo_connection():
    global mongo_client, db, collection
    if mongo_client is None:
        mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        db = mongo_client[DB_NAME]
        collection = db[COLLECTION_NAME]
    return collection

# Pydantic models
class ZoneSearchRequest(BaseModel):
    symbol: str
    timeframe: Optional[str] = "1w"  # Default to weekly

class TriggerLevel(BaseModel):
    trigger_price: float
    bottom: float
    small_red_time: int
    rally_length: int
    total_move_pct: float
    zone_index: int
    triggered: bool = False
    alert_disabled: bool = False
    last_checked: Optional[str] = None

class PushZonesRequest(BaseModel):
    symbol: str
    timeframe: str
    selected_indices: List[int]
    zones: List[dict]

class UpdateAlertRequest(BaseModel):
    symbol: str
    level_index: int
    disabled: bool

@app.get("/")
def read_root():
    return {"message": "Crypto Levels API", "version": "1.0.0"}

@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    try:
        coll = get_mongo_connection()
        coll.find_one()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

@app.post("/api/zones/search")
def search_zones(request: ZoneSearchRequest):
    """Search for support zones for a symbol in specified timeframe"""
    try:
        symbol = request.symbol.strip().upper()
        timeframe = request.timeframe or "1w"
        
        # Validate timeframe
        valid_timeframes = ["1M", "1w", "1d", "4h", "1h"]
        if timeframe not in valid_timeframes:
            raise HTTPException(status_code=400, detail=f"Invalid timeframe. Must be one of: {valid_timeframes}")
        
        zones = compute_zones_for_symbol(symbol, timeframe)
        
        # Format zones for frontend
        formatted_zones = []
        for i, zone in enumerate(zones):
            formatted_zones.append({
                "index": i,
                "top": zone["top"],
                "bottom": zone["bottom"],
                "date": ts_str(zone["small_red_time"]),
                "rally_length": zone["rally_length"],
                "total_move_pct": zone["total_move_pct"],
                "small_red_time": zone["small_red_time"]
            })
        
        return {
            "success": True,
            "symbol": symbol,
            "timeframe": timeframe,
            "zones": formatted_zones,
            "count": len(formatted_zones)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/zones/push")
def push_zones(request: PushZonesRequest):
    """Push selected zones to MongoDB"""
    try:
        coll = get_mongo_connection()
        
        # Build trigger_levels array
        trigger_levels = []
        for idx in request.selected_indices:
            zone = request.zones[idx]
            trigger_levels.append({
                "trigger_price": zone["top"],
                "bottom": zone["bottom"],
                "small_red_time": zone["small_red_time"],
                "rally_length": zone["rally_length"],
                "total_move_pct": zone["total_move_pct"],
                "zone_index": idx,
                "triggered": False,
                "alert_disabled": False,
                "last_checked": None,
                "timeframe": request.timeframe
            })
        
        # Check if document exists
        existing = coll.find_one({"symbol": request.symbol})
        
        if existing and "trigger_levels" in existing:
            # Append to existing levels
            existing_levels = existing["trigger_levels"]
            existing_levels.extend(trigger_levels)
            
            scrip_data = {
                "symbol": request.symbol,
                "timeframe": "multi",  # Multiple timeframes
                "interval": "60",
                "device_id": "web_app",
                "active": True,
                "last_updated": datetime.now().isoformat(),
                "source": "v3_multi_timeframe",
                "trigger_levels": existing_levels,
                "monitoring_type": "multi_level"
            }
        else:
            # Create new document
            scrip_data = {
                "symbol": request.symbol,
                "timeframe": request.timeframe,
                "interval": "60",
                "device_id": "web_app",
                "active": True,
                "last_updated": datetime.now().isoformat(),
                "source": "v3_multi_timeframe",
                "trigger_levels": trigger_levels,
                "monitoring_type": "multi_level"
            }
        
        # Upsert by symbol only
        result = coll.update_one(
            {"symbol": request.symbol},
            {"$set": scrip_data},
            upsert=True
        )
        
        return {
            "success": True,
            "message": f"Pushed {len(trigger_levels)} levels ({request.timeframe}) for {request.symbol}",
            "upserted": result.upserted_id is not None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/scrips")
def get_all_scrips():
    """Get all active scrips from MongoDB"""
    try:
        coll = get_mongo_connection()
        scrips = list(coll.find({"active": True, "monitoring_type": "multi_level"}))
        
        # Convert ObjectId to string
        for scrip in scrips:
            scrip["_id"] = str(scrip["_id"])
        
        return {
            "success": True,
            "scrips": scrips,
            "count": len(scrips)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/price/{symbol}")
def get_mark_price(symbol: str):
    """Get current mark price for a symbol"""
    try:
        url = "https://api.delta.exchange/v2/tickers"
        response = requests.get(url, timeout=10, headers={'Accept': 'application/json'})
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                tickers = data.get('result', [])
                for ticker in tickers:
                    if ticker.get('symbol') == symbol.upper():
                        mark_price = ticker.get('mark_price')
                        if mark_price:
                            return {
                                "success": True,
                                "symbol": symbol,
                                "mark_price": float(mark_price)
                            }
        
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"API error: {str(e)}")

@app.put("/api/scrips/{symbol}/alert")
def update_alert_status(symbol: str, request: UpdateAlertRequest):
    """Update alert status for a specific level"""
    try:
        coll = get_mongo_connection()
        
        print(f"Updating alert for {symbol}, level {request.level_index}, disabled={request.disabled}")
        
        result = coll.update_one(
            {"symbol": symbol},
            {"$set": {f"trigger_levels.{request.level_index}.alert_disabled": request.disabled}}
        )
        
        print(f"MongoDB update result: matched={result.matched_count}, modified={result.modified_count}")
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
        
        # Verify the update
        updated_doc = coll.find_one({"symbol": symbol})
        if updated_doc and "trigger_levels" in updated_doc:
            level_status = updated_doc["trigger_levels"][request.level_index].get("alert_disabled", False)
            print(f"Verified: alert_disabled is now {level_status}")
        
        return {
            "success": True,
            "message": f"Alert {'disabled' if request.disabled else 'enabled'} for level {request.level_index}",
            "updated": True
        }
    except Exception as e:
        print(f"Error updating alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/scrips/{symbol}")
def delete_scrip(symbol: str):
    """Mark a scrip as inactive"""
    try:
        coll = get_mongo_connection()
        
        result = coll.update_one(
            {"symbol": symbol},
            {"$set": {"active": False}}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
        
        return {
            "success": True,
            "message": f"Scrip {symbol} marked as inactive"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
