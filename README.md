# Korean Study Table (React + Vite)

Simple web app that displays a table with columns: `Korean`, `English`, and `Audio`. Data is loaded from a CSV file and audio files play from the `public/media` folder. No backend required.

## Quick start

Windows PowerShell:

```powershell
npm install
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

## Data

- CSV file: `public/data.csv`
- Expected columns (with header):
	- `korean`
	- `english`
	- `audio` (filename only; files should exist in `public/media`)

Notes:
- Quoted fields and commas inside quotes are supported.
- Rows must have all three fields to show in the table.

## Audio files

Place mp3 files in `public/media/` and reference them in `data.csv` via the filename (e.g. `1754333716005.mp3`).

## Studied state and filter

- Each row has a `Mark as Studied` button. When clicked, the row is marked and the state is saved in `localStorage` under the key `studiedRows`.
- Marked rows show a `Studied` label and an `Unmark` button to clear the state.
- A checkbox at the top toggles whether studied rows are shown. The preference is saved under `showStudied`.
- A small indicator next to the checkbox shows how many rows are considered studied and whether they’re being shown or hidden.

### How IDs are generated

To keep row identity stable across reloads and minor text formatting differences, each row’s ID is a hash of `korean|english` after normalization:

- Lowercased
- Unicode-normalized (NFKC)
- Punctuation/symbols removed
- Whitespace collapsed

This ensures the studied state sticks even if quotes/brackets or extra spaces are present.

### Migration of older saved state

If you previously used an older build, any prior `studiedRows` entries are migrated automatically on first load:

- Index-based keys → new IDs
- Audio-filename keys → new IDs
- Older simple hash (lowercase+trim only) → new IDs

### Troubleshooting

- “I unchecked ‘Show studied’ but still see studied rows”: reload the page to trigger migration; the counter next to the checkbox will show how many items are marked studied and whether they’re hidden. If a specific row persists, verify the `korean` and `english` fields in `data.csv` aren’t empty and that they match the displayed text. We can extend the ID to include `audio` as a tiebreaker if necessary.
- “Audio doesn’t play”: ensure the `audio` filename in `data.csv` exists in `public/media` and the extension is correct.

## Build for production

```powershell
npm run build
npm run preview
```

You can host the generated `dist/` folder on any static file host.
