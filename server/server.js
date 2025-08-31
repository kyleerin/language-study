import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.API_SECRET;
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validate required environment variables
if (!API_SECRET) {
  console.error('ERROR: API_SECRET environment variable is required');
  console.log('Please set API_SECRET in your .env file or environment');
  process.exit(1);
}

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const CSV_FILE = path.join(DATA_DIR, 'phrases.csv');
const STUDIED_FILE = path.join(DATA_DIR, 'studied.json');
const MEDIA_DIR = path.join(__dirname, '..', 'public', 'media');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for AI modal
  crossOriginEmbedderPolicy: false // Allow external API calls
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit uploads to 10 per 15 minutes
  message: { error: 'Too many file uploads, please try again later' }
});

app.use(limiter);

// CORS with restricted origins
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json({ limit: '1mb' }));

// Authentication middleware for API routes
const authenticateAPI = (req, res, next) => {
  // Skip auth for health check
  if (req.path === '/api/health') {
    return next();
  }
  
  const apiKey = req.header('X-API-Key');
  if (!apiKey || apiKey !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized - Valid API key required' });
  }
  next();
};

app.use('/api', authenticateAPI);

// Serve static audio files
app.use('/media', express.static(MEDIA_DIR));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Utility functions
function parseCSV(text) {
  const cleanCell = (value) => {
    if (value == null) return '';
    let s = String(value).trim();
    s = s.replace(/,$/, '');
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1).replace(/""/g, '"');
    }
    s = s.replace(/^"+|"+$/g, '').trim();
    s = s.replace(/^\s*-+\s*/, '').replace(/\s*-+\s*$/, '');
    return s;
  };

  const lines = text.split(/\r?\n/).filter(Boolean);
  const dataLines = lines.length > 1 && lines[0].toLowerCase().includes('korean') ? lines.slice(1) : lines;
  
  return dataLines.map(line => {
    const tokens = line.match(/(?:"(?:[^"]|"")*"|[^,]+)(?:,|$)/g) || [];
    const cols = tokens.map(cleanCell);
    const korean = cols[0] || '';
    const english = cols[1] || '';
    const audio = cols[2] || '';
    return { korean, english, audio };
  }).filter(row => row.korean && row.english);
}

function stringifyCSV(rows) {
  const header = 'korean,english,audio';
  const esc = (s = '') => {
    const needs = /[",\n]/.test(s);
    const v = s.replace(/"/g, '""');
    return needs ? `"${v}"` : v;
  };
  const body = rows.map(r => `${esc(r.korean)},${esc(r.english)},${esc(r.audio)}`);
  return [header, ...body].join('\n');
}

async function readCSVFile() {
  try {
    const data = await fs.readFile(CSV_FILE, 'utf8');
    return parseCSV(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeCSVFile(rows) {
  const csvContent = stringifyCSV(rows);
  await fs.writeFile(CSV_FILE, csvContent, 'utf8');
}

async function readStudiedData() {
  try {
    const data = await fs.readFile(STUDIED_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeStudiedData(studied) {
  await fs.writeFile(STUDIED_FILE, JSON.stringify(studied, null, 2), 'utf8');
}

// API Routes

// Get all phrases
app.get('/api/phrases', async (req, res) => {
  try {
    const phrases = await readCSVFile();
    res.json(phrases);
  } catch (error) {
    console.error('Error reading phrases:', error);
    res.status(500).json({ error: 'Failed to read phrases' });
  }
});

// Add a new phrase
app.post('/api/phrases', async (req, res) => {
  try {
    const { korean, english, audio = '' } = req.body;
    
    if (!korean || !english) {
      return res.status(400).json({ error: 'Korean and English text are required' });
    }

    const phrases = await readCSVFile();
    const newPhrase = { korean: korean.trim(), english: english.trim(), audio: audio.trim() };
    
    // Check for duplicates (basic check)
    const exists = phrases.some(p => 
      p.korean.toLowerCase() === newPhrase.korean.toLowerCase() && 
      p.english.toLowerCase() === newPhrase.english.toLowerCase()
    );
    
    if (exists) {
      return res.status(409).json({ error: 'Phrase already exists' });
    }

    phrases.unshift(newPhrase);
    await writeCSVFile(phrases);
    
    res.status(201).json(newPhrase);
  } catch (error) {
    console.error('Error adding phrase:', error);
    res.status(500).json({ error: 'Failed to add phrase' });
  }
});

// Update a phrase
app.put('/api/phrases/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const { korean, english, audio = '' } = req.body;
    
    if (!korean || !english) {
      return res.status(400).json({ error: 'Korean and English text are required' });
    }

    const phrases = await readCSVFile();
    
    if (index < 0 || index >= phrases.length) {
      return res.status(404).json({ error: 'Phrase not found' });
    }

    phrases[index] = { korean: korean.trim(), english: english.trim(), audio: audio.trim() };
    await writeCSVFile(phrases);
    
    res.json(phrases[index]);
  } catch (error) {
    console.error('Error updating phrase:', error);
    res.status(500).json({ error: 'Failed to update phrase' });
  }
});

// Delete a phrase
app.delete('/api/phrases/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const phrases = await readCSVFile();
    
    if (index < 0 || index >= phrases.length) {
      return res.status(404).json({ error: 'Phrase not found' });
    }

    const deletedPhrase = phrases.splice(index, 1)[0];
    await writeCSVFile(phrases);
    
    res.json(deletedPhrase);
  } catch (error) {
    console.error('Error deleting phrase:', error);
    res.status(500).json({ error: 'Failed to delete phrase' });
  }
});

// Import CSV file
app.post('/api/import', uploadLimiter, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file provided' });
    }

    const csvText = req.file.buffer.toString('utf8');
    const newPhrases = parseCSV(csvText);
    
    if (newPhrases.length === 0) {
      return res.status(400).json({ error: 'No valid phrases found in CSV' });
    }

    const existingPhrases = await readCSVFile();
    
    // Merge and deduplicate
    const existingMap = new Map();
    existingPhrases.forEach((phrase, index) => {
      const key = `${phrase.korean.toLowerCase()}|${phrase.english.toLowerCase()}`;
      existingMap.set(key, { ...phrase, index });
    });

    let addedCount = 0;
    newPhrases.forEach(phrase => {
      const key = `${phrase.korean.toLowerCase()}|${phrase.english.toLowerCase()}`;
      if (!existingMap.has(key)) {
        existingPhrases.push(phrase);
        addedCount++;
      }
    });

    await writeCSVFile(existingPhrases);
    
    res.json({ 
      message: `Import successful: ${addedCount} new phrases added`,
      totalPhrases: existingPhrases.length,
      newPhrases: addedCount
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    res.status(500).json({ error: 'Failed to import CSV file' });
  }
});

// Get studied data
app.get('/api/studied', async (req, res) => {
  try {
    const studied = await readStudiedData();
    res.json(studied);
  } catch (error) {
    console.error('Error reading studied data:', error);
    res.status(500).json({ error: 'Failed to read studied data' });
  }
});

// Update studied data
app.put('/api/studied', async (req, res) => {
  try {
    const studied = req.body;
    await writeStudiedData(studied);
    res.json(studied);
  } catch (error) {
    console.error('Error updating studied data:', error);
    res.status(500).json({ error: 'Failed to update studied data' });
  }
});

// Mark/unmark single item as studied
app.post('/api/studied/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { studied: isStudied } = req.body;
    
    const studiedData = await readStudiedData();
    
    if (isStudied) {
      studiedData[id] = true;
    } else {
      delete studiedData[id];
    }
    
    await writeStudiedData(studiedData);
    res.json({ id, studied: isStudied });
  } catch (error) {
    console.error('Error updating studied status:', error);
    res.status(500).json({ error: 'Failed to update studied status' });
  }
});

// Clear all studied data
app.delete('/api/studied', async (req, res) => {
  try {
    await writeStudiedData({});
    res.json({ message: 'All studied data cleared' });
  } catch (error) {
    console.error('Error clearing studied data:', error);
    res.status(500).json({ error: 'Failed to clear studied data' });
  }
});

// OpenAI proxy endpoints (optional - if OPENAI_API_KEY is set)
app.post('/api/openai/translate', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OpenAI API not configured on server' });
  }

  try {
    const { text, prompt } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: prompt || 'You are a translation assistant. Output ONLY the direct English translation, no extra commentary.' 
        },
        { role: 'user', content: text }
      ],
      temperature: 0.0,
      max_tokens: 500
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || '';
    
    res.json({ result: result.trim() });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

app.post('/api/openai/explain', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OpenAI API not configured on server' });
  }

  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that translates and explains Korean text to English with brief notes.' 
        },
        { 
          role: 'user', 
          content: `translate and explain this, don't include transliteration. Break it down word by word with explanations/definitions. Give only this, nothing else. Format it very simply, no special bulleted lists, just simple sentence/paragraph structure.: ${text}` 
        }
      ],
      temperature: 0.2,
      max_tokens: 1000
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data?.choices?.[0]?.message?.content || '';
    
    res.json({ result });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Explanation failed' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    openai: !!OPENAI_API_KEY,
    cors: CORS_ORIGINS
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Korean Study Backend running on http://localhost:${PORT}`);
  console.log(`Media files served from: ${MEDIA_DIR}`);
  console.log(`Data stored in: ${DATA_DIR}`);
});