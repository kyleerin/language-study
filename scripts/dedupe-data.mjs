#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const dataPath = path.resolve('public', 'data.csv');
const backupPath = path.resolve('public', `data.backup.${Date.now()}.csv`);

function normalize(s) {
  try {
    return (s || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/["“”'‘’\[\]\(\)]+/g, '')
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    // Fallback without Unicode property escapes
    return (s || '')
      .toLowerCase()
      .replace(/["“”'‘’\[\]\(\)]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function parseCSVLine(line) {
  // Handles quoted fields and commas inside quotes
  const matches = line.match(/(?:(?:^|,)(?:"([^"]*)"|([^,]*)))/g) || [];
  return matches.map(m => m.replace(/^,/, '').replace(/^"|"$/g, '')).map(s => s.trim());
}

function stringifyCSVRow(cells) {
  return cells.map(v => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || /\s/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}

if (!fs.existsSync(dataPath)) {
  console.error('public/data.csv not found');
  process.exit(1);
}

const text = fs.readFileSync(dataPath, 'utf8');
const lines = text.split(/\r?\n/);
if (!lines.length) {
  console.error('public/data.csv is empty');
  process.exit(1);
}

const header = lines[0];
const out = [header];
const seen = new Set();
let removed = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const cols = parseCSVLine(line);
  const korean = cols[0] || '';
  const english = cols[1] || '';
  const audio = cols[2] || '';
  if (!korean || !english || !audio) continue; // skip incomplete rows
  const key = normalize(korean) + '|' + normalize(english);
  if (seen.has(key)) {
    removed++;
    continue;
  }
  seen.add(key);
  out.push(stringifyCSVRow([korean, english, audio]));
}

fs.copyFileSync(dataPath, backupPath);
fs.writeFileSync(dataPath, out.join('\n'), 'utf8');

console.log(`Deduped data.csv: kept ${out.length - 1} rows, removed ${removed} duplicates. Backup: ${path.basename(backupPath)}`);
