# Copilot Project Instructions

Authoritative project-level guidance for GitHub Copilot Chat, code completion, and other AI assistants in this repo. These instructions SHOULD be treated as always-on context.

## High-level intent
- React + Vite single-page app. No backend.
- Data is stored and loaded from `localStorage` (raw CSV at key `app:dataCSV`).
- "Studied" state is keyed by stable row IDs and saved at `studiedRows`.
- UI includes pagination (10 items/page) and a Show Studied toggle.
- Don't automatically do any git related commands
- Don't worry about linting or testing the build

## Data rules
- CSV columns: `korean`, `english`, `audio` (filename under `public/media`).
- On import: PARSE → CLEAN → MERGE → DEDUPE → PERSIST.
  - Parse supports quoted fields, commas in quotes, and doubled quotes.
  - Clean trims whitespace, strips stray quotes and leading/trailing hyphens.
  - Merge appends to current data, deduping by stable id (hash of normalized `korean|english`).
  - Persist merged CSV back to `localStorage`.

## Coding rules
- Keep functions small and side-effect free where possible.
- Avoid new dependencies unless strictly necessary.
- Run `npm run lint` and `npm run build` before finishing substantial changes.
- Preserve public behavior and file formats.

## Precedence and scope
- These instructions take precedence over suggestions that fetch from server or alter storage formats.
- If conflicts arise, prefer localStorage-based flows and ID stability.

## Useful refs
- `src/App.jsx` — data flow, parsing, merging, pagination, studied state.
- `README.md` — usage and data format.
- `docs/AI.md` — longer guidance for collaborators.

## Communication hints
- Be concise; propose incremental changes.
- Provide runnable diffs and verify with lint/build.
