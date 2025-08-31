# Security Configuration

This document outlines the security measures implemented for the Korean Study application.

## Backend Security Features

### Authentication
- **API Key Required**: All endpoints except `/api/health` require a valid API key
- Set `API_SECRET` in your `.env` file
- Frontend prompts for API key and stores it locally

### CORS Protection
- Configurable allowed origins via `CORS_ORIGINS` environment variable
- Default: `http://localhost:5173` (development)
- Credentials enabled for authenticated requests

### Rate Limiting
- **General API**: 1000 requests per 15 minutes per IP
- **File Uploads**: 10 uploads per 15 minutes per IP
- Prevents abuse and DoS attacks

### Security Headers
- **Helmet.js** provides security headers:
  - X-Content-Type-Options
  - X-Frame-Options
  - X-XSS-Protection
  - And more...

### Input Validation
- File upload restrictions (CSV only, 10MB max)
- Request body size limits (1MB)
- Proper error handling without information disclosure

### OpenAI Integration (Optional)
- Server-side API key management
- Proxy endpoints to hide API keys from frontend
- Request/response validation

## Setup Instructions

### 1. Environment Configuration

Create `server/.env`:
```bash
# Required
API_SECRET=your-secure-random-string-here
CORS_ORIGINS=http://localhost:5173,https://yourdomain.com

# Optional (for server-side OpenAI)
OPENAI_API_KEY=your-openai-api-key-here
```

### 2. Generate Secure API Secret

```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Frontend API Key

Users will be prompted for the API key on first use. The key is stored in localStorage and sent with all requests via `X-API-Key` header.

## Data Protection

### Sensitive Files Excluded
- CSV data files (`public/*.csv`)
- Backend data directory (`server/data/`)
- Environment files (`.env`, `.env.local`)
- User-generated media files

### File Storage
- Backend stores data in `server/data/` (not in git)
- Audio files in `public/media/` (not in git)
- All sensitive data excluded from repository

## Production Deployment

### Environment Variables
Set these in your production environment:
- `NODE_ENV=production`
- `API_SECRET=<your-secure-secret>`
- `CORS_ORIGINS=https://yourdomain.com`
- `OPENAI_API_KEY=<optional>`

### Additional Security Considerations
- Use HTTPS in production
- Consider adding request logging
- Monitor for unusual activity
- Implement user accounts if needed
- Regular security updates

## API Key Management

### For Developers
1. Set `API_SECRET` in server environment
2. Share the secret securely with authorized users
3. Users enter the key when prompted by frontend

### Key Rotation
1. Generate new `API_SECRET`
2. Update server environment
3. Inform users to refresh and enter new key

## Troubleshooting

### "Unauthorized" Errors
- Check that `API_SECRET` is set in server environment
- Verify frontend is sending correct API key
- Clear localStorage and re-enter key if needed

### CORS Errors
- Verify `CORS_ORIGINS` includes your frontend URL
- Check for typos in origin URLs
- Ensure protocol (http/https) matches

### Rate Limit Errors
- Wait 15 minutes for limits to reset
- Consider increasing limits for heavy usage
- Check for automated/bot traffic