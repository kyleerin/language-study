
import { useEffect, useState } from 'react';
import './App.css';

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
    return { korean, english, audio };
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
        // migrate old index-based studied map (numeric keys) to audio-id keys
        try {
          const keys = Object.keys(studied || {});
          const hasNumeric = keys.some(k => k !== '' && !isNaN(Number(k)));
          if (hasNumeric && parsed.length) {
            const migrated = {};
            // preserve any existing audio-id entries
            parsed.forEach((row, i) => {
              if (studied[row.audio]) migrated[row.audio] = true;
              else if (studied[i]) migrated[row.audio] = true;
            });
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

  const markStudied = (audioId) => {
    setStudied(prev => ({ ...prev, [audioId]: true }));
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
              .filter((row) => showStudied || !studied[row.audio])
              .map((row) => (
              <tr key={row.audio} style={studied[row.audio] ? { background: '#d4ffd4' } : {}}>
                <td>{row.korean}</td>
                <td>{row.english}</td>
                <td>
                  {row.audio ? (
                    <audio controls src={`/media/${row.audio}`}/>
                  ) : 'No audio'}
                </td>
                <td>
                  {studied[row.audio] ? (
                    <span style={{ color: 'green', fontWeight: 'bold' }}>Studied</span>
                  ) : (
                    <button onClick={() => markStudied(row.audio)}>Mark as Studied</button>
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
