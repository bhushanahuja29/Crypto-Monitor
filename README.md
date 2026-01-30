# Crypto Levels Bhushan

Full-stack web application for finding and monitoring cryptocurrency support levels.

## Features

- **Zone Finder**: Search for weekly support zones for any crypto symbol
- **Multi-Level Monitor**: Monitor multiple support levels simultaneously with real-time price updates
- **Alert Management**: Enable/disable alerts for individual levels
- **MongoDB Integration**: Store and retrieve support levels

## Tech Stack

### Backend
- FastAPI (Python)
- MongoDB
- Deployed on Render

### Frontend
- React
- Axios for API calls
- Deployed on Vercel

## Project Structure

```
crypto_levels_bhushan/
├── backend/
│   ├── main.py           # FastAPI application
│   ├── v3.py             # Support zone calculation logic
│   ├── requirements.txt  # Python dependencies
│   └── .env             # Environment variables
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ZoneFinder.js    # Zone search page
│   │   │   └── Monitor.js       # Monitoring page
│   │   ├── App.js
│   │   └── index.js
│   ├── package.json
│   └── .env             # Environment variables
└── README.md
```

## Local Development

### Backend Setup

1. Navigate to backend directory:
```bash
cd crypto_levels_bhushan/backend
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create `.env` file with your MongoDB credentials (see `.env.example`)

4. Run the server:
```bash
python main.py
```

Backend will run on `http://localhost:8000`

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd crypto_levels_bhushan/frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```
REACT_APP_API_URL=http://localhost:8000
```

4. Run the development server:
```bash
npm start
```

Frontend will run on `http://localhost:3000`

## Deployment

### Backend (Render)

1. Push code to GitHub
2. Create new Web Service on Render
3. Connect your repository
4. Set build command: `pip install -r requirements.txt`
5. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables from `.env`
7. Deploy

### Frontend (Vercel)

1. Push code to GitHub
2. Import project on Vercel
3. Set root directory to `crypto_levels_bhushan/frontend`
4. Add environment variable: `REACT_APP_API_URL=<your-render-backend-url>`
5. Deploy

## API Endpoints

- `GET /` - Health check
- `POST /api/zones/search` - Search for support zones
- `POST /api/zones/push` - Push zones to MongoDB
- `GET /api/scrips` - Get all monitored scrips
- `GET /api/price/{symbol}` - Get current price for symbol
- `PUT /api/scrips/{symbol}/alert` - Update alert status
- `DELETE /api/scrips/{symbol}` - Delete scrip

## Environment Variables

### Backend (.env)
```
MONGODB_URI=mongodb+srv://...
DB_NAME=delta_tracker
COLLECTION_NAME=monitored_scrips
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:8000
```

## License

Private - Bhushan
