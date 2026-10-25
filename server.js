import express from 'express';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import open from 'open';
import { 
  PORT, 
  isServerless, 
  DATA_DIR, 
  CACHE_DIR, 
  THUMBS_DIR, 
  VIDEOS_DIR, 
  ARCHIVES_DIR,
  ROOT_DIR 
} from './src/config/constants.js';
import postsRoutes from './src/routes/posts.routes.js';
import tagAutocompleteRoutes from './src/routes/tagAutocomplete.routes.js';
import mediaRoutes from './src/routes/media.routes.js';
import userRoutes, { stopActiveTunnel } from './src/routes/user.routes.js';
import authRoutes from './src/routes/auth.routes.js';
import archiveRoutes from './src/routes/archive.routes.js';
import notificationsRoutes from './src/routes/notifications.routes.js';
import { initNotificationScheduler, stopNotificationScheduler } from './src/services/notificationService.js';
import { initBackupScheduler } from './src/services/backupService.js';
import { flushPendingWrites, flushPendingWritesSync, compactStoredCollections } from './src/services/storageService.js';
import { cleanupStaleUserArtifacts } from './src/services/userService.js';
import { setRuntimePort } from './src/utils/runtimeState.js';

// Rewrite collections written before the compact gzipped schema, then drop the
// artifacts nothing prunes (throwaway test accounts, quarantined corrupt-file
// copies). Failures here must never keep the server from starting.
async function runStartupMaintenance() {
  try {
    cleanupStaleUserArtifacts();
  } catch (err) {
    console.error('[Startup] Не удалось очистить устаревшие артефакты:', err.message);
  }
  try {
    await compactStoredCollections();
  } catch (err) {
    console.error('[Startup] Не удалось компактизировать коллекции:', err.message);
  }
}

// Force IPv4 first for reliable network requests to overseas Booru sites
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const app = express();

// Keep the server alive when network streams tear down
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET' || err.message?.includes('terminated') || err.message?.includes('aborted')) {
    return;
  }
  console.error('[Process UncaughtException]', err);
  void handleShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process UnhandledRejection]', reason);
});

let shuttingDown = false;
let httpServer = null;

async function handleShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    stopActiveTunnel();
    stopNotificationScheduler();
    await flushPendingWrites();
  } catch (err) {
    console.error('[Shutdown] Не удалось сбросить отложенные записи:', err);
  }
  if (httpServer) {
    await new Promise((resolve) => {
      const forcedExit = setTimeout(() => {
        httpServer.closeAllConnections?.();
        resolve();
      }, 3000);
      httpServer.close(() => {
        clearTimeout(forcedExit);
        resolve();
      });
      httpServer.closeAllConnections?.();
    });
  }
  if (signal) process.exit(signal === 'uncaughtException' ? 1 : 0);
}

process.on('SIGINT', () => { void handleShutdown('SIGINT'); });
process.on('SIGTERM', () => { void handleShutdown('SIGTERM'); });
process.on('exit', () => { flushPendingWritesSync(); });

// Initialize storage and cache directories
[DATA_DIR, CACHE_DIR, THUMBS_DIR, VIDEOS_DIR, ARCHIVES_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[FS Warning] Не удалось создать папку ${dir}:`, err.message);
  }
});

// Global middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
  );

  const origin = req.headers.origin;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.headers.host) {
        return res.status(403).json({ success: false, message: 'Cross-origin request blocked' });
      }
    } catch {
      return res.status(403).json({ success: false, message: 'Cross-origin request blocked' });
    }
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Disable caching for the API only (static assets are cached by the browser)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Frontend static assets: versioned files (?v=...) are immutable, the rest
// gets a short cache; index.html and sw.js must always revalidate.
app.use((req, res, next) => {
  if (req.query && typeof req.query.v === 'string' && req.query.v !== '') {
    res.locals.assetVersioned = true;
  }
  next();
});
const publicDir = path.join(ROOT_DIR, 'public');
app.use(express.static(publicDir, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (res.locals.assetVersioned || /dist[\\/]chunks[\\/]/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Mount modular API routers
app.use('/api/auth', authRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api', postsRoutes);
app.use('/api', tagAutocompleteRoutes);
app.use('/api', mediaRoutes);
app.use('/api', userRoutes);
app.use('/api', notificationsRoutes);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.statusCode || err?.status);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  console.error('[API Error]', req.method, req.originalUrl, err);
  res.status(safeStatus).json({ success: false, message: safeStatus >= 500 ? 'Внутренняя ошибка сервера' : err.message });
});

// SPA fallback: serve index.html for all non-API routes
let spaIndexPath = null;

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  // Resolve the path once instead of four existsSync calls per request
  if (spaIndexPath === null) {
    const candidates = [
      path.join(process.cwd(), 'public', 'index.html'),
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'index.html'),
      path.resolve('public', 'index.html')
    ];
    spaIndexPath = candidates.find(p => fs.existsSync(p)) || '';
  }
  if (spaIndexPath) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(spaIndexPath);
  }
  res.status(404).send(`index.html not found. CWD: ${process.cwd()}`);
});

// Start the HTTP server for local runs
function startServer(port) {
  httpServer = app.listen(port, async () => {
    setRuntimePort(port);
    const url = `http://localhost:${port}`;
    console.log(`\n======================================================`);
    console.log(`🚀 Booru Explorer запущен на ${url}`);
    console.log(`✨ Легковесный медиа-клиент с поддержкой видео, тегов и фильтра ИИ`);
    console.log(`======================================================\n`);

    if (!process.argv.includes('--no-open')) {
      try {
        await open(url);
      } catch (err) {
        console.log(`Откройте в браузере: ${url}`);
      }
    }
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[!] Порт ${port} занят, пробуем порт ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Ошибка запуска сервера:', err);
    }
  });
}

// Rebuild the client bundle when public/js changed or dist is missing.
// Keeps deploys reproducible: esbuild is a runtime dependency, dist is not committed.
async function ensureClientBundle() {
  try {
    const distEntry = path.join(ROOT_DIR, 'public', 'dist', 'app.js');
    const jsDir = path.join(ROOT_DIR, 'public', 'js');
    let stale = !fs.existsSync(distEntry);
    if (!stale) {
      const distMtime = fs.statSync(distEntry).mtimeMs;
      const stack = [jsDir];
      while (stack.length && !stale) {
        const dir = stack.pop();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith('.js') && fs.statSync(full).mtimeMs > distMtime) { stale = true; break; }
        }
      }
    }
    if (stale) {
      const { buildClient } = await import('./scripts/buildClient.mjs');
      console.log('[Client] Пересобираю фронтенд-бандл (public/dist)...');
      await buildClient({ logLevel: 'warning' });
    }
  } catch (err) {
    console.error('[Client] Не удалось собрать фронтенд-бандл:', err.message);
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (!isServerless && process.env.NODE_ENV !== 'test' && isMainModule) {
  await ensureClientBundle();
  initBackupScheduler();
  initNotificationScheduler();
  await runStartupMaintenance();
  startServer(Number(PORT));
}

export default app;
