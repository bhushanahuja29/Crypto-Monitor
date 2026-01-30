import os
import time
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient, UpdateOne



# ====== CONFIG ======
DELTA_BASE = os.getenv("DELTA_BASE", "https://api.delta.exchange")  # global delta
START_YEAR_TS = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp())

FETCH_WEEKS = 600              # daily fetch depth
SCAN_LAST_CLOSED_WEEKS = 400   # weekly scan depth (will clamp to available data)

# ====== MONGO ======
MONGO_DB = os.getenv("MONGO_DB", "sr_levels")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "zones")

# MongoDB connection string - can be overridden via MONGO_URI env var
MONGO_URI = os.getenv("MONGO_URI", "mongodb+srv://Bhushan:BhushanDelta@deltapricetracker.y0ipzbf.mongodb.net/?appName=DeltaPriceTracker")

try:
    mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    # Test connection
    mongo.admin.command('ping')
    print(f"✓ Connected to MongoDB: {MONGO_DB}.{MONGO_COLLECTION}")
except Exception as e:
    raise RuntimeError(f"Failed to connect to MongoDB: {e}")

db = mongo[MONGO_DB]
zones_col = db[MONGO_COLLECTION]

# Recommended index (run once manually or leave; pymongo won't create automatically here):
# db.zones.createIndex({symbol:1,timeframe:1,zone_key:1},{unique:true})


def delta_get(path, params=None):
    url = f"{DELTA_BASE}{path}"
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    j = r.json()
    if isinstance(j, dict) and j.get("success") is False:
        raise RuntimeError(f"Delta API error: {j}")
    return j


def fnum(x, default=0.0):
    if x is None:
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def fetch_candles(symbol: str, resolution: str, weeks_back: int = 600):
    """
    Fetch candles for any resolution
    resolution: '1d', '4h', '1h', '15m', etc.
    """
    end = int(time.time())
    start = end - weeks_back * 7 * 24 * 3600

    j = delta_get("/v2/history/candles", params={
        "resolution": resolution,
        "symbol": symbol,
        "start": start,
        "end": end
    })

    candles = j.get("result", [])
    norm = []
    for c in candles:
        t = c.get("time")
        if t is None:
            continue
        if t > 10**12:
            t = int(t / 1000)

        # Skip broken bars
        if c.get("open") is None or c.get("high") is None or c.get("low") is None or c.get("close") is None:
            continue

        norm.append({
            "time": int(t),
            "open": fnum(c.get("open")),
            "high": fnum(c.get("high")),
            "low":  fnum(c.get("low")),
            "close": fnum(c.get("close")),
            "volume": fnum(c.get("volume"), 0.0),
        })

    # ascending time for resample
    norm.sort(key=lambda x: x["time"])
    return norm


def fetch_daily_candles(symbol: str, weeks_back: int = 600):
    """Legacy function - calls fetch_candles with '1d'"""
    return fetch_candles(symbol, "1d", weeks_back)


def week_start_ts(day_ts: int, week_start_day: int = 0) -> int:
    """
    week_start_day: Monday=0 ... Sunday=6
    bucket start at 00:00 UTC on week_start_day
    """
    dt = datetime.fromtimestamp(day_ts, tz=timezone.utc)
    dt0 = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
    delta_days = (dt0.weekday() - week_start_day) % 7
    ws = dt0 - timedelta(days=delta_days)
    return int(ws.timestamp())


def resample_daily_to_weekly_monday(daily):
    buckets = {}
    order = []
    for d in daily:
        ws = week_start_ts(d["time"], week_start_day=0)  # Monday
        if ws not in buckets:
            buckets[ws] = {
                "time": ws,
                "open": d["open"],
                "high": d["high"],
                "low": d["low"],
                "close": d["close"],
                "volume": d["volume"],
            }
            order.append(ws)
        else:
            b = buckets[ws]
            b["high"] = max(b["high"], d["high"])
            b["low"] = min(b["low"], d["low"])
            b["close"] = d["close"]
            b["volume"] += d["volume"]

    weekly = [buckets[k] for k in order]
    weekly.sort(key=lambda x: x["time"], reverse=True)  # most recent first
    return weekly


def resample_daily_to_monthly(daily):
    """
    Resample daily candles to monthly candles
    Month starts on the 1st of each month at 00:00 UTC
    """
    buckets = {}
    order = []
    
    for d in daily:
        dt = datetime.fromtimestamp(d["time"], tz=timezone.utc)
        # Get first day of month
        month_start = datetime(dt.year, dt.month, 1, tzinfo=timezone.utc)
        ms = int(month_start.timestamp())
        
        if ms not in buckets:
            buckets[ms] = {
                "time": ms,
                "open": d["open"],
                "high": d["high"],
                "low": d["low"],
                "close": d["close"],
                "volume": d["volume"],
            }
            order.append(ms)
        else:
            b = buckets[ms]
            b["high"] = max(b["high"], d["high"])
            b["low"] = min(b["low"], d["low"])
            b["close"] = d["close"]
            b["volume"] += d["volume"]
    
    monthly = [buckets[k] for k in order]
    monthly.sort(key=lambda x: x["time"], reverse=True)  # most recent first
    return monthly


def is_green(c): return c["close"] > c["open"]
def is_red(c):   return c["close"] < c["open"]
def body_size(c): return abs(c["close"] - c["open"])


def compute_zone_for_bar(candles_most_recent_first, base_offset):
    """
    Runs your Pine logic on historical weekly bars where view[0] is the 'current bar'
    base_offset=1 => last CLOSED weekly candle is current (skip live week)
    """
    if base_offset + 30 >= len(candles_most_recent_first):
        return None

    view = candles_most_recent_first[base_offset:]

    # avgBody = sma(bodySize(0), 10)
    bodies = [body_size(view[i]) for i in range(0, 10)]
    avg_body = sum(bodies) / 10.0

    # Identify rally (3+ consecutive green weekly candles)
    rally_len = 0
    for i in range(0, 11):
        if is_green(view[i]):
            rally_len += 1
        else:
            break

    if rally_len < 3:
        return None

    rally_start_low = view[rally_len - 1]["low"]
    rally_end_close = view[0]["close"]
    total_move = ((rally_end_close - rally_start_low) / rally_start_low) * 100.0
    if total_move < 10:
        return None

    # Find small red candle i in [rally_len .. rally_len+2]
    for i in range(rally_len, rally_len + 3):
        c = view[i]
        small_body_condition = body_size(c) < 0.3 * c["open"]
        avg_body_condition   = body_size(c) < 0.5 * avg_body

        adjacent_green = (is_green(view[i - 1]) if i - 1 >= 0 else False) or \
                         (is_green(view[i + 1]) if i + 1 < len(view) else False)

        if is_red(c) and small_body_condition and avg_body_condition and adjacent_green:
            if c["time"] >= START_YEAR_TS:
                top = float(c["open"])
                bottom = float(c["close"])
                if bottom > top:
                    top, bottom = bottom, top

                return {
                    "current_week_time": view[0]["time"],
                    "small_red_time": c["time"],
                    "top": top,
                    "bottom": bottom,
                    "rally_length": rally_len,
                    "total_move_pct": float(total_move),
                    "small_red_offset": i,
                }

    return None


def dedupe_zones_keep_most_recent(zones):
    """
    Dedup by (top,bottom). Keep most recent occurrence.
    """
    seen = set()
    out = []
    for z in zones:
        key = z["zone_key"]
        if key in seen:
            continue
        seen.add(key)
        out.append(z)
    return out


def ts_str(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def compute_zones_for_symbol(symbol: str, timeframe: str = "1w"):
    """
    Compute zones for different timeframes
    timeframe: '1M' (monthly), '1w' (weekly), '1d' (daily), '4h', '1h'
    """
    print(f"DEBUG: compute_zones_for_symbol called with symbol={symbol}, timeframe={timeframe}")
    
    if timeframe == "1M":
        print("DEBUG: Using MONTHLY timeframe")
        # Monthly analysis - resample from daily
        daily = fetch_daily_candles(symbol, weeks_back=800)  # ~15 years of data
        candles = resample_daily_to_monthly(daily)
        min_candles = 40
        rally_min = 2
        move_min = 15
    elif timeframe == "1w":
        print("DEBUG: Using WEEKLY timeframe")
        # Weekly analysis - resample from daily
        daily = fetch_daily_candles(symbol, weeks_back=FETCH_WEEKS)
        candles = resample_daily_to_weekly_monday(daily)
        min_candles = 60
        rally_min = 3
        move_min = 10
    elif timeframe == "1d":
        print("DEBUG: Using DAILY timeframe")
        # Daily analysis - use daily candles directly
        candles = fetch_daily_candles(symbol, weeks_back=FETCH_WEEKS)
        candles.sort(key=lambda x: x["time"], reverse=True)
        min_candles = 100
        rally_min = 3
        move_min = 8
    elif timeframe == "4h":
        print("DEBUG: Using 4H timeframe")
        # 4-hour analysis
        candles = fetch_candles(symbol, "4h", weeks_back=200)
        candles.sort(key=lambda x: x["time"], reverse=True)
        min_candles = 150
        rally_min = 4
        move_min = 6
    elif timeframe == "1h":
        print("DEBUG: Using 1H timeframe")
        # 1-hour analysis
        candles = fetch_candles(symbol, "1h", weeks_back=100)
        candles.sort(key=lambda x: x["time"], reverse=True)
        min_candles = 200
        rally_min = 5
        move_min = 5
    else:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    print(f"DEBUG: Got {len(candles)} candles, min_candles={min_candles}, rally_min={rally_min}, move_min={move_min}")
    
    if len(candles) < min_candles:
        print(f"DEBUG: Not enough candles ({len(candles)} < {min_candles}), returning empty")
        return []

    start_offset = 1
    max_scan = len(candles) - 35
    scan_depth = SCAN_LAST_CLOSED_WEEKS if timeframe in ["1w", "1M"] else min(400, max_scan - start_offset)
    end_offset = min(start_offset + scan_depth, max_scan)

    print(f"DEBUG: Scanning from offset {start_offset} to {end_offset}")

    zones = []
    for base_offset in range(start_offset, end_offset):
        z = compute_zone_for_bar_flexible(candles, base_offset, rally_min, move_min)
        if z:
            z["symbol"] = symbol
            z["timeframe"] = timeframe
            z["zone_key"] = f"{z['top']:.8f}|{z['bottom']:.8f}"
            zones.append(z)

    zones = dedupe_zones_keep_most_recent(zones)
    print(f"DEBUG: Found {len(zones)} zones for {symbol} in {timeframe}")
    return zones


def compute_zone_for_bar_flexible(candles_most_recent_first, base_offset, rally_min=3, move_min=10):
    """
    Flexible zone computation for any timeframe
    """
    if base_offset + 30 >= len(candles_most_recent_first):
        return None

    view = candles_most_recent_first[base_offset:]

    # avgBody = sma(bodySize(0), 10)
    bodies = [body_size(view[i]) for i in range(0, min(10, len(view)))]
    avg_body = sum(bodies) / len(bodies) if bodies else 0

    # Identify rally (rally_min+ consecutive green candles)
    rally_len = 0
    for i in range(0, min(11, len(view))):
        if is_green(view[i]):
            rally_len += 1
        else:
            break

    if rally_len < rally_min:
        return None

    rally_start_low = view[rally_len - 1]["low"]
    rally_end_close = view[0]["close"]
    total_move = ((rally_end_close - rally_start_low) / rally_start_low) * 100.0
    if total_move < move_min:
        return None

    # Find small red candle i in [rally_len .. rally_len+2]
    for i in range(rally_len, min(rally_len + 3, len(view))):
        c = view[i]
        small_body_condition = body_size(c) < 0.3 * c["open"]
        avg_body_condition   = body_size(c) < 0.5 * avg_body if avg_body > 0 else True

        adjacent_green = (is_green(view[i - 1]) if i - 1 >= 0 else False) or \
                         (is_green(view[i + 1]) if i + 1 < len(view) else False)

        if is_red(c) and small_body_condition and avg_body_condition and adjacent_green:
            if c["time"] >= START_YEAR_TS:
                top = float(c["open"])
                bottom = float(c["close"])
                if bottom > top:
                    top, bottom = bottom, top

                return {
                    "current_week_time": view[0]["time"],
                    "small_red_time": c["time"],
                    "top": top,
                    "bottom": bottom,
                    "rally_length": rally_len,
                    "total_move_pct": float(total_move),
                    "small_red_offset": i,
                }

    return None


def upsert_zones(symbol: str, zones: list):
    now = datetime.now(timezone.utc)

    ops = []
    for z in zones:
        doc = {
            "symbol": z["symbol"],
            "timeframe": z["timeframe"],
            "zone_key": z["zone_key"],
            "top": z["top"],
            "bottom": z["bottom"],
            "small_red_time": z["small_red_time"],
            "current_week_time": z["current_week_time"],
            "pattern_metadata": {
                "rally_length": z["rally_length"],
                "total_move_pct": z["total_move_pct"],
                "small_red_offset": z["small_red_offset"],
                "weekly_anchor": "Mon_UTC",
                "source": "delta_api_1d_resample_1w"
            },
            "updated_at": now,
            "status": "active",
        }

        ops.append(UpdateOne(
            {"symbol": doc["symbol"], "timeframe": doc["timeframe"], "zone_key": doc["zone_key"]},
            {"$set": doc},
            upsert=True
        ))

    if ops:
        res = zones_col.bulk_write(ops, ordered=False)
        return {"upserted": res.upserted_count, "modified": res.modified_count, "matched": res.matched_count}
    return {"upserted": 0, "modified": 0, "matched": 0}


def main():
    symbol = input("Enter Delta perp symbol (e.g., BTCUSDT, ETHUSDT): ").strip().upper()
    if not symbol:
        print("No symbol provided.")
        return

    zones = compute_zones_for_symbol(symbol)
    print(f"\nSymbol: {symbol}")
    print(f"Unique zones computed: {len(zones)}")

    for z in zones[:12]:
        print(
            f"AtWeek={ts_str(z['current_week_time'])} | "
            f"TOP={z['top']:.2f} BOTTOM={z['bottom']:.2f} | "
            f"SmallRed={ts_str(z['small_red_time'])} | "
            f"RallyLen={z['rally_length']} Move={z['total_move_pct']:.2f}%"
        )

    result = upsert_zones(symbol, zones)
    print(f"\nMongo upsert result: {result}")
    print(f"DB: {MONGO_DB}, Collection: {MONGO_COLLECTION}")


if __name__ == "__main__":
    main()