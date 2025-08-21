
import { useEffect, useState } from 'react';
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
    .replace(/["“”'‘’\[\]\(\)]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalize = (s) => {
    try {
      // Prefer full unicode normalization with punctuation/symbol removal
      return (s || '')
        .toLowerCase()
        .normalize('NFKC')
        .replace(/["“”'‘’\[\]\(\)]+/g, '')
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
  const lines = text.split(/\r?\n/).filter(Boolean);
  // Skip header line if present
  const dataLines = lines.length > 1 && lines[0].toLowerCase().includes('korean') ? lines.slice(1) : lines;
  return dataLines.map(line => {
    // Handle quoted values and commas inside quotes
    const cols = line.match(/(?:"([^"]*)"|([^,]+))(?:,|$)/g)?.map(c => c.replace(/^"|"$/g, '').replace(/,$/, '').trim()) || [];
    const korean = cols[0] || '';
    const english = cols[1] || '';
    const audio = cols[2] || '';
    const id = makeId(korean, english);
    return { id, korean, english, audio };
  }).filter(row => row.korean && row.english && row.audio);
}

function App() {
  const [rows, setRows] = useState([]);
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

  useEffect(() => {
    fetch('/data.csv')
      .then(res => res.text())
      .then(text => {
        const parsed = parseCSV(text);
        setRows(parsed);
        // migrate old keys (index-based, audio-based, or legacy simple-id) to current id-based keys
        try {
          const keys = Object.keys(studied || {});
          if (!keys.length) return;

          const migrated = {};
          parsed.forEach((row, i) => {
            const simpleId = makeIdSimple(row.korean, row.english);
            if (studied[row.id]) migrated[row.id] = true; // already on new id
            else if (studied[simpleId]) migrated[row.id] = true; // legacy simple hash id
            else if (studied[row.audio]) migrated[row.id] = true; // audio-based id
            else if (studied[i]) migrated[row.id] = true; // index-based id
          });

          // Only persist if migration changes the effective mapping
          const migratedKeys = Object.keys(migrated);
          const currentIdSet = new Set(parsed.map(r => r.id));
          const effectiveOld = parsed.filter(r => studied[r.id]).length;
          const effectiveNew = migratedKeys.filter(id => currentIdSet.has(id)).length;
          if (effectiveNew !== effectiveOld || effectiveNew > 0) {
            setStudied(migrated);
            localStorage.setItem('studiedRows', JSON.stringify(migrated));
          }
        } catch {}
      });
  }, []);

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

  return (
    <div className="container">
      <h1>Korean Words Table</h1>
      <div style={{ margin: '1rem 0' }}>
        <label style={{ marginRight: 12 }}>
          <input
            type="checkbox"
            checked={showStudied}
            onChange={(e) => setShowStudied(e.target.checked)}
          />{' '}
          Show studied
        </label>
        <span style={{ opacity: 0.7, marginLeft: 12, fontSize: 12 }}>
          {Object.keys(studied).length} studied • {showStudied ? 'showing all' : 'hiding studied'}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Korean</th>
            <th>English</th>
            <th>Audio</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center' }}>
                No data found. Please check your CSV file format and columns.
              </td>
            </tr>
          ) : (
            rows
              .filter((row) => showStudied || !studied[row.id])
              .map((row) => (
              <tr key={row.id} style={studied[row.id] ? { background: '#d4ffd4' } : {}}>
                <td>{row.korean}</td>
                <td>{row.english}</td>
                <td>
                  {row.audio ? (
                    <audio controls src={`/media/${row.audio}`}/>
                  ) : 'No audio'}
                </td>
                <td>
                  {studied[row.id] ? (
                    <>
                      <span style={{ color: 'green', fontWeight: 'bold', marginRight: 8 }}>Studied</span>
                      <button onClick={() => unmarkStudied(row.id)} aria-label="Unmark as studied">Unmark</button>
                    </>
                  ) : (
                    <button onClick={() => markStudied(row.id)} aria-label="Mark as studied">Mark as Studied</button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default App
