const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const chokidar = require('chokidar');
const { FontCatalog } = require('./catalog');
const { FONT_EXTENSIONS } = require('./font-analyzer');

const APP_ROOT = path.resolve(__dirname, '..');
const FONTS_DIRECTORY = path.resolve(APP_ROOT, process.env.FONT_DIR || 'Fonts');
const OUTPUT_PATH = path.join(APP_ROOT, 'font_categories.json');
const PORT = Number(process.env.PORT) || 3000;

function createApp(catalog, fontsDirectory = FONTS_DIRECTORY) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(APP_ROOT, 'public'), { index: 'index.html' }));

  app.get('/api/catalog', (_request, response) => {
    response.json(catalog.getSnapshot());
  });

  app.get('/api/events', (request, response) => {
    response.set({
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream'
    });
    response.flushHeaders();
    const sendUpdate = (snapshot) => response.write(`event: catalog\ndata: ${JSON.stringify(snapshot)}\n\n`);
    const handleUpdate = (snapshot) => sendUpdate(snapshot);
    catalog.events.on('updated', handleUpdate);
    request.on('close', () => catalog.events.off('updated', handleUpdate));
    sendUpdate(catalog.getSnapshot());
  });

  app.get('/api/fonts/:fileName', async (request, response, next) => {
    const fileName = request.params.fileName;
    if (
      path.basename(fileName) !== fileName ||
      !FONT_EXTENSIONS.has(path.extname(fileName).toLowerCase())
    ) {
      response.status(400).json({ error: 'Invalid font file name.' });
      return;
    }
    const filePath = path.resolve(fontsDirectory, fileName);
    if (path.dirname(filePath) !== path.resolve(fontsDirectory)) {
      response.status(400).json({ error: 'Invalid font file path.' });
      return;
    }
    try {
      const stats = await fs.lstat(filePath);
      if (!stats.isFile()) {
        response.status(404).json({ error: 'Font file not found.' });
        return;
      }
      response.sendFile(filePath, (error) => {
        if (error) next(error);
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.status(404).json({ error: 'Font file not found.' });
        return;
      }
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(`Request failed: ${error.message}`);
    if (response.headersSent) return;
    response.status(500).json({ error: 'The request could not be completed.' });
  });
  return app;
}

async function startServer() {
  const catalog = new FontCatalog({ fontsDirectory: FONTS_DIRECTORY, outputPath: OUTPUT_PATH });
  await fs.mkdir(FONTS_DIRECTORY, { recursive: true });

  let scanTimer;
  let scanRunning = false;
  let scanQueued = false;
  const runScan = async () => {
    if (scanRunning) {
      scanQueued = true;
      return;
    }
    scanRunning = true;
    try {
      await catalog.scan();
      console.log(`Font catalog updated: ${catalog.snapshot.total_families} families, ${catalog.snapshot.total_files} files.`);
    } catch (error) {
      console.error(`Font catalog scan failed: ${error.message}`);
    } finally {
      scanRunning = false;
      if (scanQueued) {
        scanQueued = false;
        scheduleScan();
      }
    }
  };
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(runScan, 350);
  };

  const watcher = chokidar.watch(FONTS_DIRECTORY, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 100 },
    ignored: (filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      return extension !== '' && !FONT_EXTENSIONS.has(extension);
    }
  });
  watcher.on('add', scheduleScan);
  watcher.on('change', scheduleScan);
  watcher.on('unlink', scheduleScan);
  watcher.on('error', (error) => console.error(`Font watcher error: ${error.message}`));

  await runScan();
  const server = createApp(catalog).listen(PORT, () => {
    console.log(`Font catalog is available at http://localhost:${PORT}`);
    console.log(`Watching ${FONTS_DIRECTORY}`);
  });

  const shutdown = async () => {
    clearTimeout(scanTimer);
    await watcher.close();
    server.close((error) => {
      if (error) {
        console.error(`HTTP server shutdown failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Unable to start font catalog: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
