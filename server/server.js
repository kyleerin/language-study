import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const CSV_FILE = path.join(DATA_DIR, 'phrases.csv');
const STUDIED_FILE = path.join(DATA_DIR, 'studied.json');
const MEDIA_DIR = path.join(__dirname, '..', 'public', 'media');

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());

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
app.post('/api/import', upload.single('csvFile'), async (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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