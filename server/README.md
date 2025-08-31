# Korean Study Backend

Express.js backend API for the Korean Study application.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Start the server:
```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

The server runs on `http://localhost:3001` by default.

## API Endpoints

### Phrases Management
- `GET /api/phrases` - Get all phrases
- `POST /api/phrases` - Add new phrase (`{korean, english, audio?}`)
- `PUT /api/phrases/:index` - Update phrase by index
- `DELETE /api/phrases/:index` - Delete phrase by index
- `POST /api/import` - Import CSV file (multipart form with `csvFile` field)

### Study Progress
- `GET /api/studied` - Get studied data
- `PUT /api/studied` - Update all studied data
- `POST /api/studied/:id` - Mark/unmark single item (`{studied: boolean}`)
- `DELETE /api/studied` - Clear all studied data

### Media & Health
- `GET /media/*` - Serve audio files
- `GET /api/health` - Health check

## Data Storage

- **CSV Data**: `server/data/phrases.csv`
- **Study Progress**: `server/data/studied.json`
- **Audio Files**: `public/media/` (served via `/media/*`)

## Features

- File upload with validation (CSV only, 10MB max)
- Automatic deduplication on import
- CORS enabled for frontend integration
- Error handling and validation
- Static file serving for audio files

## Frontend Integration

Update your frontend to use `http://localhost:3001` as the API base URL instead of localStorage.