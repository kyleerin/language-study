
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

  useEffect(() => {
    fetch('/data.csv')
      .then(res => res.text())
      .then(text => {
        setRows(parseCSV(text));
      });
  }, []);

  return (
    <div className="container">
      <h1>Korean Words Table</h1>
      <table>
        <thead>
          <tr>
            <th>Korean</th>
            <th>English</th>
            <th>Audio</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ textAlign: 'center' }}>
                No data found. Please check your CSV file format and columns.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                <td>{row.korean}</td>
                <td>{row.english}</td>
                <td>
                  {row.audio ? (
                    <audio controls src={`/media/${row.audio}`}/>
                  ) : 'No audio'}
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
