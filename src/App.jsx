
import { useEffect, useRef, useState } from 'react';
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
  }).filter(row => row.korean && row.english && row.audio);
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

  // Build and copy an AI prompt based on the Korean text
  const buildPrompt = (koreanText = '') => `translate and explain this: ${koreanText}`;
  const copyText = async (text) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (err) {
      console.error('Copy failed', err);
      alert('Failed to copy prompt to clipboard');
      return false;
    }
  };
  const copyPromptFor = async (koreanText = '') => {
    const prompt = buildPrompt(koreanText);
    await copyText(prompt);
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
    } catch {
      // no-op
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
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

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Korean Words Table</h1>
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
          <button
            onClick={clearAllStudied}
            aria-label="Clear all studied"
            title="Clear all studied"
          >Reset All</button>
        </div>
      </div>
      <div style={{ margin: '1rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            {Object.keys(studied).length} studied • {showStudied ? 'showing all' : 'hiding studied'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={gotoPrev} disabled={clampedPage <= 1} aria-label="Previous page">‹ Prev</button>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              Page {clampedPage} / {totalPages}
            </span>
            <button onClick={gotoNext} disabled={clampedPage >= totalPages} aria-label="Next page">Next ›</button>
          </div>
        </div>
      </div>
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
                <tr key={row.id} style={studied[row.id] ? { background: '#d4ffd4' } : {}}>
                  <td className="col-korean">{row.korean}</td>
                  <td className="col-english">{row.english}</td>
                  <td className="col-audio">
                    {row.audio ? (
                      <audio controls src={`/media/${row.audio}`}/>
                    ) : 'No audio'}
                  </td>
                  <td className="col-action">
                    <div className="icon-row-actions">
                      {studied[row.id] ? (
                        <>
                          <button
                            className="icon-btn"
                            onClick={() => copyPromptFor(row.korean)}
                            aria-label="Copy AI prompt for this Korean text"
                            title="Copy AI prompt"
                          >🧠</button>
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
                            onClick={() => copyPromptFor(row.korean)}
                            aria-label="Copy AI prompt for this Korean text"
                            title="Copy AI prompt"
                          >🧠</button>
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
    </div>
  );
}

export default App
