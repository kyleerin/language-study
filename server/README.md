# Korean Study Backend

Express.js backend API for the Korean Study application.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Configure environment:
```bash
# Copy example file
cp .env.example .env

# Edit .env with your values:
# API_SECRET=your-secure-secret-here
# CORS_ORIGINS=http://localhost:5173
# OPENAI_API_KEY=your-openai-key (optional)
```

3. Start the server:
```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

The server runs on `http://localhost:3001` by default.

## Security

⚠️ **Important**: This server requires authentication via API key.

- Set `API_SECRET` in your `.env` file
- Users must provide this key when using the frontend
- All endpoints except `/api/health` require authentication
- See `SECURITY.md` for complete security documentation

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

### OpenAI Integration (Optional)
- `POST /api/openai/translate` - Translate text (`{text, prompt?}`)
- `POST /api/openai/explain` - Explain Korean text (`{text}`)

### Media & Health
- `GET /media/*` - Serve audio files
- `GET /api/health` - Health check (no auth required)

## Data Storage

- **CSV Data**: `server/data/phrases.csv`
- **Study Progress**: `server/data/studied.json`
- **Audio Files**: `public/media/` (served via `/media/*`)

## Features

- **Security**: API key authentication, CORS protection, rate limiting
- **File Upload**: CSV validation (10MB max) with deduplication
- **OpenAI Integration**: Server-side API proxy (optional)
- **Error Handling**: Proper validation and error responses
- **Static Files**: Audio file serving
- **Headers**: Security headers via Helmet.js

## Frontend Integration

Update your frontend to use `http://localhost:3001` as the API base URL instead of localStorage.