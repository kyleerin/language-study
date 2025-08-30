
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

// Stable ID based on korean+english
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h >>> 0) + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24));
  }
  return (h >>> 0).toString(36);
}
function makeId(korean, english) {
  const fallbackNormalize = (s) => (s || '')
    .toLowerCase()
  .replace(/["“”'‘’()]+/g, '')
  .replaceAll('[', '')
  .replaceAll(']', '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalize = (s) => {
    try {
      // Prefer full unicode normalization with punctuation/symbol removal
      return (s || '')
        .toLowerCase()
        .normalize('NFKC')
  .replace(/["“”'‘’()]+/g, '')
  .replaceAll('[', '')
  .replaceAll(']', '')
        .replace(/[\p{P}\p{S}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      // Fallback for environments without Unicode property escapes support
      return fallbackNormalize(s);
    }
  };
  const key = `${normalize(korean)}|${normalize(english)}`;
  return fnv1aHash(key);
}

// Legacy simple id used previously (lowercase+trim only)
function makeIdSimple(korean, english) {
  const key = `${(korean || '').trim().toLowerCase()}|${(english || '').trim().toLowerCase()}`;
  return fnv1aHash(key);
}

function parseCSV(text) {
  const cleanCell = (value) => {
    if (value == null) return '';
    let s = String(value).trim();
    // Strip trailing comma if any (from tokenization)
    s = s.replace(/,$/, '');
    // Unquote if wrapped in quotes and unescape doubled quotes per RFC 4180
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1).replace(/""/g, '"');
    }
    // Cleanup for previously-corrupted cells that ended up with stray quotes
    s = s.replace(/^"+|"+$/g, '').trim();
  // Remove leading/trailing hyphens with optional surrounding spaces
  s = s.replace(/^\s*-+\s*/, '').replace(/\s*-+\s*$/, '');
    return s;
  };

  const lines = text.split(/\r?\n/).filter(Boolean);
  // Skip header line if present
  const dataLines = lines.length > 1 && lines[0].toLowerCase().includes('korean') ? lines.slice(1) : lines;
  return dataLines.map(line => {
    // Tokenize with support for commas inside quoted fields and escaped quotes
    const tokens = line.match(/(?:"(?:[^"]|"")*"|[^,]+)(?:,|$)/g) || [];
    const cols = tokens.map(cleanCell);
    const korean = cols[0] || '';
    const english = cols[1] || '';
    const audio = cols[2] || '';
    const id = makeId(korean, english);
    return { id, korean, english, audio };
  }).filter(row => row.korean && row.english); // Allow rows without audio
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

function App() {
  const [rows, setRows] = useState([]);
  const fileInputRef = useRef(null);
  // Map of row.id -> boolean (loop enabled)
  const [looping, setLooping] = useState({});
  // Audio element refs keyed by row id
  const audioRefs = useRef({});
  const [page, setPage] = useState(1);
  const [studied, setStudied] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('studiedRows') || '{}');
    } catch {
      return {};
    }
  });
  const [showStudied, setShowStudied] = useState(() => {
    try {
      const v = localStorage.getItem('showStudied');
      return v === null ? true : v === 'true';
    } catch {
      return true;
    }
  });
  const [search, setSearch] = useState('');
  // Single-item study view state
  const [singleView, setSingleView] = useState(false);
  const [singleIndex, setSingleIndex] = useState(0); // index within filteredRows
  // Random-item study view state
  const [randomView, setRandomView] = useState(false);
  const [randomIndex, setRandomIndex] = useState(null); // null until selected
  const [randomSeen, setRandomSeen] = useState([]); // indices we've already shown in this random session

  // AI modal state
  const [aiOpen, setAiOpen] = useState(false);
  // Store prompt implicitly via run call; no separate state needed
  const [aiResponse, setAiResponse] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const aiAbortRef = useRef(null);

  // Simple localStorage-backed AI cache
  const getAICache = () => {
    try {
      const raw = localStorage.getItem('openai:cache');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const setAICacheValue = (id, value) => {
    try {
      const cache = getAICache();
      cache[id] = String(value || '');
      localStorage.setItem('openai:cache', JSON.stringify(cache));
    } catch { /* best-effort */ }
  };
  const getAICacheValue = (id) => {
    try { const v = getAICache()[id]; return typeof v === 'string' ? v : ''; } catch { return ''; }
  };

  // Load data from localStorage (always) on first mount
  useEffect(() => {
    try {
      const csv = localStorage.getItem('app:dataCSV');
      if (csv && csv.trim()) {
        const parsed = parseCSV(csv);
        setRows(parsed);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    }
  }, []);

  // When rows change, migrate any old studied keys to current id-based keys
  useEffect(() => {
    try {
      if (!rows?.length) return;
      const keys = Object.keys(studied || {});
      if (!keys.length) return;

      const migrated = {};
      rows.forEach((row, i) => {
        const simpleId = makeIdSimple(row.korean, row.english);
        if (studied[row.id]) migrated[row.id] = true; // already on new id
        else if (studied[simpleId]) migrated[row.id] = true; // legacy simple hash id
        else if (studied[row.audio]) migrated[row.id] = true; // audio-based id
        else if (studied[i]) migrated[row.id] = true; // index-based id
      });

  // Only persist if migrated mapping actually differs from current id-based mapping
  const migratedKeys = Object.keys(migrated);
  const currentIdSet = new Set(rows.map(r => r.id));
  const studiedIdKeys = Object.keys(studied).filter(k => currentIdSet.has(k));
  const sameSize = studiedIdKeys.length === migratedKeys.length;
  const sameAll = sameSize && migratedKeys.every(k => studied[k]);
  if (!sameAll) {
        setStudied(migrated);
        localStorage.setItem('studiedRows', JSON.stringify(migrated));
      }
    } catch {
      // no-op
    }
  }, [rows, studied]);

  useEffect(() => {
    localStorage.setItem('studiedRows', JSON.stringify(studied));
  }, [studied]);

  useEffect(() => {
    localStorage.setItem('showStudied', String(showStudied));
  }, [showStudied]);

  const markStudied = (id) => {
    setStudied(prev => ({ ...prev, [id]: true }));
  };
  const unmarkStudied = (id) => {
    setStudied(prev => {
      if (!prev[id]) return prev;
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const toggleLoop = (id) => {
    setLooping(prev => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id]; // keep object sparse
      return next;
    });
    // After state updates, attempt to play/pause accordingly in microtask
    setTimeout(() => {
      const el = audioRefs.current[id];
      if (!el) return;
      if (looping[id]) {
        // Was looping -> about to disable (since state not yet updated in closure). Pause.
        try { el.pause(); } catch { /* ignore */ }
      } else {
        // Was not looping -> enabling.
        try { el.currentTime = 0; el.play(); } catch { /* ignore */ }
      }
    }, 0);
  };

  // Build AI prompt from the Korean text
  const buildPrompt = (koreanText = '') => `translate and explain this, don't include transliteration. Break it down word by word with explanations/definitions. Give only this, nothing else. Format it very simply, no special bulleted lists, just simple sentence/paragraph structure.: ${koreanText}`;
  // Build example sentence prompt (single concise example usage with translation)
  const buildExamplePrompt = (koreanText = '') => `Give ONE natural Korean example sentence that correctly uses this phrase or word (${koreanText}).\nRules: 1) Provide the Korean sentence on the first line. 2) On the next line give ONLY the English translation. 3) Keep it level-appropriate and not overly formal unless required. 4) Do not include romanization, explanations, bullet points, numbering, quotes, or any extra commentary.`;
  
  // Run AI request and display in modal
  const runAIModal = async (promptText = '', cacheKey = '') => {
    try {
      // Use cached response if present
      const cached = cacheKey ? getAICacheValue(cacheKey) : '';
      if (cached) {
        setAiStatus('');
        setAiResponse(cached);
        return;
      }
      setAiStatus('Querying OpenAI…');
      setAiResponse('');
      // Abort management
  if (aiAbortRef.current) { try { aiAbortRef.current.abort(); } catch { /* ignore abort errors */ } }
      const ac = new AbortController();
      aiAbortRef.current = ac;

      const key = (localStorage.getItem('openai:key') || '').trim();
  const model = (localStorage.getItem('openai:model') || 'gpt-5').trim() || 'gpt-5';
      if (!key) {
        setAiStatus('No API key saved. Open AI Settings in the main app to add your key.');
        return;
      }
      const timeoutMs = 45000;
      const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const to = setTimeout(() => { try { ac.abort(); } catch { /* ignore abort */ } reject(new Error('Request timed out after ' + ms/1000 + 's')); }, ms);
        p.then(v => { clearTimeout(to); resolve(v); }, e => { clearTimeout(to); reject(e); });
      });
      const chatCompletions = async (overrideModel) => {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: overrideModel || model,
            messages: [
              { role: 'system', content: 'You are a helpful assistant that translates and explains Korean text to English with brief notes.' },
              { role: 'user', content: promptText }
            ],
            temperature: 0.2
          }),
          signal: ac.signal
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error('HTTP ' + res.status + ' ' + res.statusText + (errText ? ('\n' + errText) : ''));
        }
        const data = await res.json();
        return (data?.choices?.[0]?.message?.content) || '';
      };
      const responsesAPI = async (overrideModel) => {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: overrideModel || model, input: promptText, temperature: 0.2 }),
          signal: ac.signal
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error('HTTP ' + res.status + ' ' + res.statusText + (errText ? ('\n' + errText) : ''));
        }
        const data = await res.json();
        if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
        if (Array.isArray(data?.output)) {
          const parts = [];
          for (const item of data.output) {
            if (item?.content) {
              if (Array.isArray(item.content)) parts.push(item.content.map(c => c?.text || '').join(''));
              else if (typeof item.content === 'string') parts.push(item.content);
            }
          }
          const joined = parts.join('\n').trim();
          if (joined) return joined;
        }
        return JSON.stringify(data, null, 2);
      };

      let msg = '';
      // Attempt with chosen model; if fails and was gpt-5, fallback automatically to gpt-4o-mini
      const primaryModel = model;
      const fallbackModel = primaryModel === 'gpt-5' ? 'gpt-4o-mini' : null;
      const attemptSequence = [
        { fn: () => chatCompletions(primaryModel) },
        { fn: () => responsesAPI(primaryModel) },
        ...(fallbackModel ? [
          { fn: () => chatCompletions(fallbackModel) },
          { fn: () => responsesAPI(fallbackModel) }
        ] : [])
      ];
      let success = false;
      for (const step of attemptSequence) {
        try {
          msg = await withTimeout(step.fn(), timeoutMs);
          success = true;
          break;
        } catch { /* try next */ }
      }
      if (!success) throw new Error('All model attempts failed');
  setAiResponse(msg || '[No content]');
  if (cacheKey && msg) setAICacheValue(cacheKey, msg);
      setAiStatus('');
    } catch (e) {
      console.error(e);
      const m = (e && e.message ? e.message : 'Unknown error');
      const hint = m.includes('Failed to fetch') ? '\nHint: Browser may have blocked the request. Ensure you are running from http(s) and that your network allows calls to api.openai.com.' : '';
      setAiStatus('Error: ' + m + hint);
    }
  };

  const closeAIModal = () => {
    try { if (aiAbortRef.current) aiAbortRef.current.abort(); } catch { /* ignore */ }
    setAiOpen(false);
    // Keep last response visible on reopen? Clear for now to avoid stale content
    setAiResponse('');
    setAiStatus('');
  };

  // Manual add form state
  const [addOpen, setAddOpen] = useState(false);
  const [addKorean, setAddKorean] = useState('');
  const [addEnglish, setAddEnglish] = useState('');
  const [addStatus, setAddStatus] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editRowId, setEditRowId] = useState('');
  const [editKorean, setEditKorean] = useState('');
  const [editEnglish, setEditEnglish] = useState('');
  const [editAudio, setEditAudio] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const openAddModal = () => {
    setAddKorean('');
    setAddEnglish('');
    setAddStatus('');
    setAddBusy(false);
    setAddOpen(true);
  };
  const closeAddModal = () => {
    if (addBusy) return; // prevent closing while busy
    setAddOpen(false);
  };

  // Reusable OpenAI request helper (simple, translation only usage)
  const openAIRequest = async (promptText) => {
    const key = (localStorage.getItem('openai:key') || '').trim();
    const model = (localStorage.getItem('openai:model') || 'gpt-5').trim() || 'gpt-5';
    if (!key) throw new Error('No OpenAI API key saved. Open AI Settings first.');
    const ac = new AbortController();
    const timeoutMs = 30000;
    const withTimeout = (p) => new Promise((resolve, reject) => {
      const to = setTimeout(() => { try { ac.abort(); } catch { /* ignore */ } reject(new Error('Request timed out')); }, timeoutMs);
      p.then(v => { clearTimeout(to); resolve(v); }, e => { clearTimeout(to); reject(e); });
    });
    const chatCompletions = async (overrideModel) => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: overrideModel || model,
            messages: [
              { role: 'system', content: 'You are a translation assistant. Output ONLY the direct English translation, no extra commentary.' },
              { role: 'user', content: promptText }
            ],
            temperature: 0.0
        }),
        signal: ac.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return (data?.choices?.[0]?.message?.content) || '';
    };
    const responsesAPI = async (overrideModel) => {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: overrideModel || model, input: promptText, temperature: 0.0 }),
        signal: ac.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (typeof data?.output_text === 'string') return data.output_text;
      return JSON.stringify(data);
    };
    const primaryModel = model;
    const fallbackModel = primaryModel === 'gpt-5' ? 'gpt-4o-mini' : null;
    const steps = [() => chatCompletions(primaryModel), () => responsesAPI(primaryModel)];
    if (fallbackModel) steps.push(() => chatCompletions(fallbackModel), () => responsesAPI(fallbackModel));
    for (const fn of steps) {
      try { return await withTimeout(fn()); } catch { /* try next */ }
    }
    throw new Error('All translation attempts failed');
  };

  const handleAddSave = async () => {
    const koreanText = (addKorean || '').trim();
    if (!koreanText) { setAddStatus('Enter Korean text first.'); return; }
    try {
      setAddBusy(true);
      setAddStatus(addEnglish ? 'Saving…' : 'Translating…');
      let englishText = (addEnglish || '').trim();
      if (!englishText) {
        const prompt = `give me only the translation: ${koreanText}`;
        englishText = (await openAIRequest(prompt)).trim();
        // Collapse newlines / excess spaces
        englishText = englishText.replace(/\s+/g, ' ').trim();
      }
      if (!englishText) englishText = '[Translation missing]';
      const id = makeId(koreanText, englishText);
      const newRow = { id, korean: koreanText, english: englishText, audio: '' };
      setRows(prev => {
        const existingIdx = prev.findIndex(r => r.id === id);
        if (existingIdx !== -1) return prev; // already exists, skip
        const next = [newRow, ...prev];
        try { localStorage.setItem('app:dataCSV', stringifyCSV(next)); } catch { /* ignore */ }
        return next;
      });
      setAddStatus('Added');
      setTimeout(() => { setAddOpen(false); }, 400);
    } catch (e) {
      setAddStatus('Error: ' + (e?.message || 'unknown'));
    } finally {
      setAddBusy(false);
    }
  };

  const openEditModal = (row) => {
    if (!row) return;
    setEditRowId(row.id);
    setEditKorean(row.korean || '');
    setEditEnglish(row.english || '');
    setEditAudio(row.audio || '');
    setEditStatus('');
    setEditBusy(false);
    setEditOpen(true);
  };
  const closeEditModal = () => { if (editBusy) return; setEditOpen(false); };
  const handleEditSave = () => {
    const k = editKorean.trim();
    const e = editEnglish.trim();
    const a = editAudio.trim();
    if (!k || !e) { setEditStatus('Korean and English required.'); return; }
    try {
      setEditBusy(true);
      const newId = makeId(k, e);
      setRows(prev => {
        const idx = prev.findIndex(r => r.id === editRowId);
        if (idx === -1) return prev;
        // If newId collides with different row, prevent update
        const collision = prev.find(r => r.id === newId && r.id !== editRowId);
        if (collision) {
          setEditStatus('Another entry already has this Korean+English.');
          return prev;
        }
        const updated = { id: newId, korean: k, english: e, audio: a };
        const next = [...prev];
        next[idx] = updated;
        try { localStorage.setItem('app:dataCSV', stringifyCSV(next)); } catch { /* ignore */ }
        // If id changed, migrate studied/looping/audioRefs
        if (newId !== editRowId) {
          setStudied(prevStudied => {
            if (!prevStudied[editRowId]) return prevStudied;
            const { [editRowId]: _old, ...rest } = prevStudied;
            return { ...rest, [newId]: true };
          });
          setLooping(prevLoop => {
            if (!prevLoop[editRowId]) return prevLoop;
            const { [editRowId]: _old2, ...rest } = prevLoop;
            return { ...rest, [newId]: true };
          });
          try {
            if (audioRefs.current[editRowId]) {
              audioRefs.current[newId] = audioRefs.current[editRowId];
              delete audioRefs.current[editRowId];
            }
          } catch { /* ignore */ }
        }
        setEditStatus('Saved');
        setTimeout(() => setEditOpen(false), 350);
        return next;
      });
    } catch (e) {
      setEditStatus('Error saving');
    } finally {
      setEditBusy(false);
    }
  };

  const openPromptWindow = (promptText = '', cacheKey = '') => {
    setAiOpen(true);
    // Defer run to next tick so modal renders immediately
    setTimeout(() => runAIModal(String(promptText || ''), String(cacheKey || '')), 0);
  };
  const openPromptFor = (row = null) => {
    try {
      if (!row) return;
      const prompt = buildPrompt(row.korean || '');
      const id = row.id || makeId(row.korean || '', row.english || '');
      const cached = getAICacheValue(id);
      const key = (localStorage.getItem('openai:key') || '').trim();
      // If no key and no cache, route user to settings first
      if (!key && !cached) { openAISettingsWindow(); return; }
      // Otherwise open modal; it will use cache if available or call API
      openPromptWindow(prompt, id);
    } catch { /* no-op */ }
  };

  // Open example sentence modal for a row (separate cache key suffix ':ex')
  const openExampleFor = (row = null) => {
    try {
      if (!row) return;
      const prompt = buildExamplePrompt(row.korean || '');
      const baseId = row.id || makeId(row.korean || '', row.english || '');
      const cacheId = baseId + ':ex';
      const cached = getAICacheValue(cacheId);
      const key = (localStorage.getItem('openai:key') || '').trim();
      if (!key && !cached) { openAISettingsWindow(); return; }
      openPromptWindow(prompt, cacheId);
    } catch { /* no-op */ }
  };

  const clearAllStudied = () => {
    try {
      const hasAny = Object.keys(studied || {}).length > 0;
      if (!hasAny) return;
      const ok = window.confirm('Clear studied state for all items?');
      if (!ok) return;
      setStudied({});
    } catch {
      // no-op
    }
  };

  // Delete a row entirely: remove from rows, persist CSV, and clean up studied state
  const deleteRow = (id) => {
    try {
      // Optional confirm to avoid accidental deletes
      const ok = window.confirm('Delete this row from your saved data? This cannot be undone.');
      if (!ok) return;

      let nextRowsSnapshot = [];
      setRows(prevRows => {
        const nextRows = prevRows.filter(r => r.id !== id);
        nextRowsSnapshot = nextRows;
        try {
          const csv = stringifyCSV(nextRows);
          localStorage.setItem('app:dataCSV', csv);
        } catch {
          // persist best-effort
        }
        return nextRows;
      });

      // Remove any studied flag for this id
      setStudied(prev => {
        if (!prev[id]) return prev;
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      // Remove any looping flag
      setLooping(prev => {
        if (!prev[id]) return prev;
        const { [id]: _removed2, ...rest } = prev;
        return rest;
      });
      // Cleanup audio ref
      try { delete audioRefs.current[id]; } catch { /* ignore */ }

      // Adjust page if current page becomes empty
      setPage(p => {
        try {
          const q = (search || '').trim().toLowerCase();
          const matchesSearch = (r) => !q || (r.korean || '').toLowerCase().includes(q) || (r.english || '').toLowerCase().includes(q);
          const nextFilteredCount = (nextRowsSnapshot || []).filter(r => (showStudied || !studied[r.id]) && matchesSearch(r)).length;
          const newTotal = Math.max(1, Math.ceil(nextFilteredCount / itemsPerPage));
          return Math.min(p, newTotal);
        } catch {
          return p;
        }
      });

      // If in single view, clamp index if needed
      if (singleView) {
        setSingleIndex(i => {
          const idxInFiltered = filteredRows.findIndex(r => r.id === id);
          if (idxInFiltered !== -1 && i >= idxInFiltered) {
            // shift left if we deleted an item at or before current index
            return Math.max(0, i - 1);
          }
          return i;
        });
      }
    } catch {
      // no-op
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Open a settings window to save OpenAI API key and preferred model
  const openAISettingsWindow = () => {
    try {
      const w = window.open('', 'ai-settings', 'width=560,height=420,resizable,scrollbars');
      if (!w) { alert('Please allow popups for this site to open AI settings.'); return; }
      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>AI Settings</title>
  <style>
    :root { --bg:#0f1117; --panel:#151922; --border:#2a2f3a; --text:#e6e6e6; --muted:#a0a6b1; --btn:#2b2f3a; --btn-hover:#343a49; --btn-border:#3a4150; --btn-border-hover:#4a5568; --input:#0f131a; --accent:#3b82f6; }
    html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;}
    .wrap{display:flex;flex-direction:column;min-height:100%;}
    header{padding:10px 12px;border-bottom:1px solid var(--border);background:var(--panel);display:flex;align-items:center;justify-content:space-between;gap:8px}
    main{padding:16px 14px;display:flex;flex-direction:column;gap:14px}
    label{font-size:12px;color:var(--muted)}
    .field{display:flex;flex-direction:column;gap:6px}
    input[type=password], input[type=text], select{background:var(--input);color:var(--text);border:1px solid var(--btn-border);border-radius:6px;padding:8px 10px}
    .row{display:flex;align-items:center;gap:8px}
    .grow{flex:1}
    button{padding:8px 12px;border-radius:6px;background:var(--btn);color:var(--text);border:1px solid var(--btn-border);cursor:pointer}
    button:hover{background:var(--btn-hover);border-color:var(--btn-border-hover)}
    .actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
    .status{font-size:12px;color:var(--muted)}
  </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <strong>AI Settings</strong>
        <div class="actions">
          <button id="closeBtn">Close</button>
        </div>
      </header>
      <main>
        <div class="field">
          <label for="apiKey">OpenAI API Key</label>
          <div class="row">
            <input id="apiKey" class="grow" type="password" placeholder="sk-..." autocomplete="off" />
            <button id="toggle">Show</button>
          </div>
        </div>
        <div class="field">
          <label for="model">Default Model</label>
          <select id="model">
            <option value="gpt-5" selected>gpt-5</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          </select>
        </div>
        <div class="actions">
          <button id="saveBtn">Save</button>
          <span id="status" class="status"></span>
        </div>
      </main>
    </div>
    <script>
      const apiKeyEl = document.getElementById('apiKey');
      const modelEl = document.getElementById('model');
      const status = document.getElementById('status');
      const toggleBtn = document.getElementById('toggle');
      const saveBtn = document.getElementById('saveBtn');
      const closeBtn = document.getElementById('closeBtn');

      // Load existing values from localStorage (popup and opener)
      try {
        const ls = window.localStorage;
        const key1 = ls.getItem('openai:key');
        const model1 = ls.getItem('openai:model');
        if (key1) apiKeyEl.value = key1;
        if (model1) modelEl.value = model1;
  } catch { void 0; }
      try {
        const ols = window.opener?.localStorage;
        if (ols) {
          const key2 = ols.getItem('openai:key');
          const model2 = ols.getItem('openai:model');
          if (!apiKeyEl.value && key2) apiKeyEl.value = key2;
          if (!modelEl.value && model2) modelEl.value = model2;
        }
  } catch { void 0; }

      toggleBtn.addEventListener('click', () => {
        apiKeyEl.type = apiKeyEl.type === 'password' ? 'text' : 'password';
        toggleBtn.textContent = apiKeyEl.type === 'password' ? 'Show' : 'Hide';
      });

      saveBtn.addEventListener('click', () => {
        try {
          const key = apiKeyEl.value.trim();
          const model = modelEl.value || 'gpt-4o-mini';
          localStorage.setItem('openai:key', key);
          localStorage.setItem('openai:model', model);
          if (window.opener?.localStorage) {
            window.opener.localStorage.setItem('openai:key', key);
            window.opener.localStorage.setItem('openai:model', model);
          }
          status.textContent = 'Saved';
          setTimeout(() => status.textContent = '', 1500);
        } catch (e) {
          status.textContent = 'Save failed';
        }
      });

      closeBtn.addEventListener('click', () => window.close());
    </script>
  </body>
  </html>`;
      w.document.open(); w.document.write(html); w.document.close(); w.focus();
  } catch { void 0; }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      // Merge with current rows (dedupe by stable id from korean+english)
      const sanitizeRow = (r) => ({
          ...r,
          korean: stripEdgeHyphens((r.korean || '').replace(/^"+|"+$/g, '').trim()),
          english: stripEdgeHyphens((r.english || '').replace(/^"+|"+$/g, '').trim()),
          audio: stripEdgeHyphens((r.audio || '').replace(/^"+|"+$/g, '').trim()),
      });
        const stripEdgeHyphens = (s='') => s.replace(/^\s*-+\s*/, '').replace(/\s*-+\s*$/, '');
      const map = new Map((rows || []).map(r => {
        const s = sanitizeRow(r);
        return [s.id, s];
      }));
      for (const r of parsed) {
        const s = sanitizeRow(r);
        if (!map.has(s.id)) map.set(s.id, s);
      }
      const merged = Array.from(map.values());
      // Persist merged CSV so data is always loaded from localStorage on next load
      const mergedCsv = stringifyCSV(merged);
      localStorage.setItem('app:dataCSV', mergedCsv);
      setRows(merged);
      // Reset to first page after import to show newly available data consistently
      setPage(1);
    } catch (err) {
      console.error('Failed to import CSV', err);
      alert('Failed to import CSV file. Please check the format.');
    } finally {
      // Allow re-importing the same file by clearing the value
      e.target.value = '';
    }
  };

  // Derived: filtered rows and pagination
  const itemsPerPage = 10;
  const q = (search || '').trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    if (!showStudied && studied[row.id]) return false;
    if (!q) return true;
    const k = (row.korean || '').toLowerCase();
    const e = (row.english || '').toLowerCase();
    return k.includes(q) || e.includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / itemsPerPage));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  if (clampedPage !== page) {
    // keep state in sync without extra renders
    setPage(clampedPage);
  }
  const start = (clampedPage - 1) * itemsPerPage;
  const currentPageRows = filteredRows.slice(start, start + itemsPerPage);
  const placeholdersCount = Math.max(0, itemsPerPage - currentPageRows.length);

  // Reset to first page whenever search changes so results start from beginning
  useEffect(() => {
    setPage(1);
  }, [search]);

  const gotoPrev = () => setPage((p) => Math.max(1, p - 1));
  const gotoNext = () => setPage((p) => Math.min(totalPages, p + 1));

  // When filteredRows length changes, clamp singleIndex
  useEffect(() => {
    if (!singleView) return;
    setSingleIndex(i => {
      if (filteredRows.length === 0) return 0;
      return Math.min(Math.max(0, i), filteredRows.length - 1);
    });
  }, [filteredRows.length, singleView]);

  const gotoSinglePrev = () => {
    setSingleIndex(i => Math.max(0, i - 1));
  };
  const gotoSingleNext = () => {
    setSingleIndex(i => Math.min(filteredRows.length - 1, i + 1));
  };
  const currentSingleRow = singleView ? filteredRows[singleIndex] : null;

  const enterSingleView = () => {
    if (!singleView) {
      const startIdx = (clampedPage - 1) * itemsPerPage;
      setSingleIndex(startIdx < filteredRows.length ? startIdx : 0);
    }
    setRandomView(false);
    setSingleView(true);
  };
  const enterTableView = () => { setSingleView(false); setRandomView(false); };

  const pickRandomIndex = () => {
    if (!filteredRows.length) { setRandomIndex(null); setRandomSeen([]); return; }
    // Build a list of unseen indices
    const total = filteredRows.length;
    const seenSet = new Set(randomSeen);
    const unseen = [];
    for (let i = 0; i < total; i++) if (!seenSet.has(i)) unseen.push(i);
    if (unseen.length === 0) {
      // All seen – keep current index, nothing to do
      return;
    }
    const idx = unseen[Math.floor(Math.random() * unseen.length)];
    setRandomIndex(idx);
    setRandomSeen(prev => [...prev, idx]);
  };
  const enterRandomView = () => {
    setSingleView(false);
    setRandomView(true);
    setRandomSeen([]);
    setRandomIndex(null);
    // Defer to next tick so filteredRows (if changed) are considered
    setTimeout(() => pickRandomIndex(), 0);
  };
  const allRandomSeen = randomSeen.length && filteredRows.length && randomSeen.length >= filteredRows.length;

  // Close modal on Escape
  useEffect(() => {
    if (!aiOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeAIModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [aiOpen]);

  // Keyboard navigation in single view (Left/Right arrows)
  useEffect(() => {
    if (!singleView) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') {
        setSingleIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setSingleIndex(i => Math.min(filteredRows.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [singleView, filteredRows.length]);

  // Keyboard in random view: Space / Right Arrow -> next random (unseen)
  useEffect(() => {
    if (!randomView) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.code === 'Space') {
        if (!allRandomSeen) {
          e.preventDefault();
          pickRandomIndex();
        }
      }
    };
    window.addEventListener('keydown', onKey, { passive: false });
    return () => window.removeEventListener('keydown', onKey);
  }, [randomView, filteredRows.length, randomIndex, allRandomSeen]);

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Phrases</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button onClick={handleImportClick} aria-label="Import CSV and save to localStorage">
            Import CSV
          </button>
          <button onClick={openAddModal} aria-label="Add a new phrase manually">Add Text</button>
          <button
            onClick={openAISettingsWindow}
            aria-label="Open AI settings"
            title="Open AI settings"
          >AI Settings</button>
          <button
            onClick={clearAllStudied}
            aria-label="Clear all studied"
            title="Clear all studied"
          >Reset All</button>
        </div>
      </div>
      <div style={{ margin: '1rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        {!singleView && !randomView && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Korean or English…"
                aria-label="Search Korean or English"
                style={{ paddingRight: 26 }}
              />
              {search ? (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  title="Clear search"
                  style={{ position: 'absolute', right: 2, border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 6px' }}
                >×</button>
              ) : null}
            </div>
            <label style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={showStudied}
                onChange={(e) => setShowStudied(e.target.checked)}
              />{' '}
              Show studied
            </label>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {Object.keys(studied).length} studied • {showStudied ? 'showing all' : 'hiding studied'}
          </span>
          {!singleView && !randomView && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={gotoPrev} disabled={clampedPage <= 1} aria-label="Previous page">‹ Prev</button>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                Page {clampedPage} / {totalPages}
              </span>
              <button onClick={gotoNext} disabled={clampedPage >= totalPages} aria-label="Next page">Next ›</button>
            </div>
          )}
        </div>
      </div>
      <div className="view-mode-switch" style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
        <div className="view-mode-inner" style={{ marginLeft: 0 }}>
          <button
            className={!singleView && !randomView ? 'active' : ''}
            onClick={enterTableView}
            aria-label="Show table view"
            title="Show table view"
            disabled={!singleView && !randomView}
          >Table View</button>
          <button
            className={singleView ? 'active' : ''}
            onClick={enterSingleView}
            aria-label="Show single item view"
            title="Show single item view"
            disabled={singleView}
          >Single View</button>
          <button
            className={randomView ? 'active' : ''}
            onClick={enterRandomView}
            aria-label="Show random item view"
            title="Show random item view"
            disabled={randomView}
          >Random View</button>
        </div>
      </div>
      {singleView ? (
        <div className="single-view">
          {filteredRows.length === 0 ? (
            <div className="single-empty">No data found. {rows.length === 0 ? 'Click "Import CSV" (top right) to load your data.' : 'Try changing filters.'}</div>
          ) : (
            <div className="single-card">
              <div className="single-text korean" style={{ fontSize: '2.2rem', marginBottom: 12 }}>
                {currentSingleRow?.korean}
              </div>
              <div className="single-text english" style={{ fontSize: '1.4rem', marginBottom: 20, opacity: 0.9 }}>
                {currentSingleRow?.english}
              </div>
              <div className="single-audio" style={{ marginBottom: 18 }}>
                {currentSingleRow?.audio ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <audio
                      controls
                      src={`/media/${currentSingleRow.audio}`}
                      ref={el => { if (el && currentSingleRow) audioRefs.current[currentSingleRow.id] = el; }}
                      loop={!!looping[currentSingleRow?.id]}
                      style={{ width: 360, maxWidth: '90%' }}
                    />
                    {currentSingleRow ? (
                      <button
                        className="icon-btn"
                        onClick={() => toggleLoop(currentSingleRow.id)}
                        aria-label={looping[currentSingleRow.id] ? 'Disable repeat' : 'Enable repeat'}
                        title={looping[currentSingleRow.id] ? 'Disable repeat' : 'Enable repeat'}
                        style={looping[currentSingleRow.id] ? { background: '#2b2f3a', borderColor: '#4a5568' } : undefined}
                      >{looping[currentSingleRow.id] ? '🔁' : '↻'}</button>
                    ) : null}
                  </div>
                ) : 'No audio'}
              </div>
              <div className="flex-spacer" />
              {currentSingleRow ? (
                <div className="single-actions" style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
                  <button className="icon-btn" onClick={() => openPromptFor(currentSingleRow)} title="Run AI" aria-label="Run AI">🧠</button>
                  {studied[currentSingleRow.id] ? (
                    <button className="icon-btn" onClick={() => unmarkStudied(currentSingleRow.id)} title="Unmark studied" aria-label="Unmark studied">↺</button>
                  ) : (
                    <button className="icon-btn" onClick={() => markStudied(currentSingleRow.id)} title="Mark studied" aria-label="Mark studied">✓</button>
                  )}
                  <button className="icon-btn" onClick={() => openEditModal(currentSingleRow)} title="Edit" aria-label="Edit">✎</button>
                  <button className="icon-btn danger" onClick={() => deleteRow(currentSingleRow.id)} title="Delete" aria-label="Delete">🗑</button>
                </div>
              ) : null}
              <div className="single-nav" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <button onClick={gotoSinglePrev} disabled={singleIndex <= 0} aria-label="Previous item">‹ Prev</button>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{filteredRows.length ? (singleIndex + 1) : 0} / {filteredRows.length}</span>
                <button onClick={gotoSingleNext} disabled={singleIndex >= filteredRows.length - 1} aria-label="Next item">Next ›</button>
              </div>
            </div>
          )}
        </div>
      ) : randomView ? (
        <div className="single-view random-view">
          {filteredRows.length === 0 ? (
            <div className="single-empty">No data found. {rows.length === 0 ? 'Click "Import CSV" (top right) to load your data.' : 'Try changing filters.'}</div>
          ) : (
            <div className="single-card">
              <div className="single-text korean" style={{ fontSize: '2.2rem', marginBottom: 12 }}>
                {filteredRows[randomIndex]?.korean}
              </div>
              <div className="single-text english" style={{ fontSize: '1.4rem', marginBottom: 20, opacity: 0.9 }}>
                {filteredRows[randomIndex]?.english}
              </div>
              <div className="single-audio" style={{ marginBottom: 18 }}>
                {filteredRows[randomIndex]?.audio ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <audio
                      controls
                      src={filteredRows[randomIndex]?.audio ? `/media/${filteredRows[randomIndex].audio}` : undefined}
                      ref={el => { if (el && filteredRows[randomIndex]) audioRefs.current[filteredRows[randomIndex].id] = el; }}
                      loop={!!looping[filteredRows[randomIndex]?.id]}
                      style={{ width: 360, maxWidth: '90%' }}
                    />
                    {filteredRows[randomIndex] ? (
                      <button
                        className="icon-btn"
                        onClick={() => toggleLoop(filteredRows[randomIndex].id)}
                        aria-label={looping[filteredRows[randomIndex].id] ? 'Disable repeat' : 'Enable repeat'}
                        title={looping[filteredRows[randomIndex].id] ? 'Disable repeat' : 'Enable repeat'}
                        style={looping[filteredRows[randomIndex].id] ? { background: '#2b2f3a', borderColor: '#4a5568' } : undefined}
                      >{looping[filteredRows[randomIndex].id] ? '🔁' : '↻'}</button>
                    ) : null}
                  </div>
                ) : 'No audio'}
              </div>
              <div className="flex-spacer" />
              {filteredRows[randomIndex] ? (
                <div className="single-actions" style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
                  <button className="icon-btn" onClick={() => openPromptFor(filteredRows[randomIndex])} title="Run AI" aria-label="Run AI">🧠</button>
                  <button className="icon-btn" onClick={() => openExampleFor(filteredRows[randomIndex])} title="Example sentence" aria-label="Generate example sentence">💬</button>
                  {studied[filteredRows[randomIndex].id] ? (
                    <button className="icon-btn" onClick={() => unmarkStudied(filteredRows[randomIndex].id)} title="Unmark studied" aria-label="Unmark studied">↺</button>
                  ) : (
                    <button className="icon-btn" onClick={() => markStudied(filteredRows[randomIndex].id)} title="Mark studied" aria-label="Mark studied">✓</button>
                  )}
                  <button className="icon-btn" onClick={() => openEditModal(filteredRows[randomIndex])} title="Edit" aria-label="Edit">✎</button>
                  <button className="icon-btn danger" onClick={() => deleteRow(filteredRows[randomIndex].id)} title="Delete" aria-label="Delete">🗑</button>
                </div>
              ) : null}
              <div className="single-nav" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <button
                  onClick={pickRandomIndex}
                  disabled={allRandomSeen}
                  aria-label="Show another random unseen item"
                >{allRandomSeen ? 'All items seen' : 'Another Random'}</button>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{randomSeen.length} / {filteredRows.length} seen</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-korean">Korean</th>
                <th className="col-english">English</th>
                <th className="col-audio">Audio</th>
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
        {filteredRows.length === 0 ? (
              <>
                <tr>
                  <td colSpan={4}>
            No data found. {rows.length === 0 ? 'Click "Import CSV" (top right) to load your data.' : 'Try changing filters.'}
                  </td>
                </tr>
                {Array.from({ length: itemsPerPage - 1 }).map((_, idx) => (
                  <tr key={`ph-empty-${idx}`} className="placeholder" aria-hidden="true">
                    <td className="col-korean"></td>
                    <td className="col-english"></td>
                    <td className="col-audio"></td>
                    <td className="col-action"></td>
                  </tr>
                ))}
              </>
            ) : (
              <>
                {currentPageRows.map((row) => (
                  <tr key={row.id} className={studied[row.id] ? 'studied' : ''}>
                    <td className="col-korean">{row.korean}</td>
                    <td className="col-english">{row.english}</td>
                    <td className="col-audio">
                      {row.audio ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <audio
                            controls
                            src={`/media/${row.audio}`}
                            ref={el => { if (el) audioRefs.current[row.id] = el; else delete audioRefs.current[row.id]; }}
                            loop={!!looping[row.id]}
                          />
                          <button
                            className="icon-btn"
                            onClick={() => toggleLoop(row.id)}
                            aria-label={looping[row.id] ? 'Disable repeat' : 'Enable repeat'}
                            title={looping[row.id] ? 'Disable repeat' : 'Enable repeat'}
                            style={looping[row.id] ? { background: '#2b2f3a', borderColor: '#4a5568' } : undefined}
                          >{looping[row.id] ? '🔁' : '↻'}</button>
                        </div>
                      ) : 'No audio'}
                    </td>
                    <td className="col-action">
                      <div className="action-cell-inner">
                        <div className="icon-row-actions">
                        {studied[row.id] ? (
                          <>
                            <button
                              className="icon-btn"
                              onClick={() => openPromptFor(row)}
                              aria-label="Run AI on this Korean text"
                              title="Run AI"
                            >🧠</button>
                              <button
                                className="icon-btn"
                                onClick={() => openEditModal(row)}
                                aria-label="Edit row"
                                title="Edit row"
                              >✎</button>
                            <button
                              className="icon-btn"
                              onClick={() => unmarkStudied(row.id)}
                              aria-label="Unmark as studied"
                              title="Unmark as studied"
                            >↺</button>
                            <button
                              className="icon-btn danger"
                              onClick={() => deleteRow(row.id)}
                              aria-label="Delete row"
                              title="Delete row"
                            >🗑</button>
                          </>
                        ) : (
                          <>
                            <button
                              className="icon-btn"
                              onClick={() => openPromptFor(row)}
                              aria-label="Run AI on this Korean text"
                              title="Run AI"
                            >🧠</button>
                            <button
                              className="icon-btn"
                              onClick={() => openEditModal(row)}
                              aria-label="Edit row"
                              title="Edit row"
                            >✎</button>
                            <button
                              className="icon-btn"
                              onClick={() => markStudied(row.id)}
                              aria-label="Mark as studied"
                              title="Mark as studied"
                            >✓</button>
                            <button
                              className="icon-btn danger"
                              onClick={() => deleteRow(row.id)}
                              aria-label="Delete row"
                              title="Delete row"
                            >🗑</button>
                          </>
                        )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {Array.from({ length: placeholdersCount }).map((_, idx) => (
                  <tr key={`ph-${idx}`} className="placeholder" aria-hidden="true">
                    <td className="col-korean"></td>
                    <td className="col-english"></td>
                    <td className="col-audio"></td>
                    <td className="col-action"></td>
                  </tr>
                ))}
              </>
            )}
            </tbody>
          </table>
        </div>
      )}

      {aiOpen ? (
        <div className="modal-overlay" onClick={closeAIModal}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            {aiStatus ? (<div className="ai-status">{aiStatus}</div>) : null}
            <div className="ai-output" aria-live="polite">
              <ReactMarkdown>{aiResponse || ''}</ReactMarkdown>
            </div>
          </div>
        </div>
      ) : null}
      {addOpen ? (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Add Phrase</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Korean</span>
                <textarea
                  rows={3}
                  value={addKorean}
                  onChange={(e) => setAddKorean(e.target.value)}
                  placeholder="Enter Korean text"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>English (leave blank to auto-translate)</span>
                <textarea
                  rows={2}
                  value={addEnglish}
                  onChange={(e) => setAddEnglish(e.target.value)}
                  placeholder="Will be filled by AI if left blank"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{addStatus}</span>
                <button onClick={closeAddModal} disabled={addBusy}>Cancel</button>
                <button onClick={handleAddSave} disabled={addBusy}>{addBusy ? 'Working…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {editOpen ? (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Edit Phrase</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Korean</span>
                <textarea
                  rows={3}
                  value={editKorean}
                  onChange={(e) => setEditKorean(e.target.value)}
                  placeholder="Korean text"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>English</span>
                <textarea
                  rows={2}
                  value={editEnglish}
                  onChange={(e) => setEditEnglish(e.target.value)}
                  placeholder="English translation"
                  style={{ resize: 'vertical' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Audio filename (optional)</span>
                <input
                  type="text"
                  value={editAudio}
                  onChange={(e) => setEditAudio(e.target.value)}
                  placeholder="e.g. 12345.mp3 or 12345_prev.jpg"
                />
              </label>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                ID will update automatically if Korean or English change (used for dedup & studied tracking).
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{editStatus}</span>
                <button onClick={closeEditModal} disabled={editBusy}>Cancel</button>
                <button onClick={handleEditSave} disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App
