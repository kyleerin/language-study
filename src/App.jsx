
import { useEffect, useState } from 'react';
import './App.css';

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    const cols = line.split('\t');
    // Korean: cols[6], English: cols[7], Audio: last col ending with .mp3
    const korean = cols[6] || '';
    const english = cols[7] || '';
    const audioCol = cols.findLast(c => c.endsWith('.mp3'));
    return { korean, english, audio: audioCol };
  }).filter(row => row.korean && row.english && row.audio);
}

function App() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetch('/items.csv')
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
          {rows.map((row, idx) => (
            <tr key={idx}>
              <td>{row.korean}</td>
              <td>{row.english}</td>
              <td>
                {row.audio ? (
                  <audio controls src={`/media/${row.audio}`}/>
                ) : 'No audio'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App
