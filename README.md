# Typeface Font Catalog

A local Node.js application that scans `Fonts/`, groups font variants into families, classifies families, writes `font_categories.json`, and serves a searchable preview interface.

## Run locally

Requires Node.js 18 or later.

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The app scans `Fonts/` at startup and watches it for additions, changes, and removals. `FONT_DIR` can point to a different directory; relative values are resolved from the app root. `PORT` changes the web server port.

`font_categories.json` is regenerated after each completed scan. Font metadata is read from the font name, OS/2, and post tables. Unreadable font files are reported in the server log and the web interface while the rest of the catalog continues to update.

Classification uses PANOSE values, fixed-pitch and character-map data, and family-name heuristics. For uncertain classifications, configure `GOOGLE_FONTS_API_KEY` to enable category lookup through the Google Fonts Developer API; when no key is configured or a lookup is unsuccessful, the app retains its local best-effort classification.

## API

- `GET /api/catalog` returns the current catalog and any scan errors.
- `GET /api/events` streams catalog updates to connected browsers.
- `GET /api/fonts/:fileName` serves a font file from the monitored directory for browser previews.
