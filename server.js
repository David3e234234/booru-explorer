import express from 'express';
import cors from 'cors';
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
import mediaRoutes from './src/routes/media.routes.js';
import userRoutes from './src/routes/user.routes.js';
import authRoutes from './src/routes/auth.routes.js';
import archiveRoutes from './src/routes/archive.routes.js';
import { initBackupScheduler } from './src/services/backupService.js';

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
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process UnhandledRejection]', reason);
});

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
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Disable caching for the API only (static assets are cached by the browser)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Frontend static assets: etag + one hour of caching (caching used to be fully disabled,
// so the browser re-downloaded every bundle on each visit)
const publicDir = path.join(ROOT_DIR, 'public');
app.use(express.static(publicDir, {
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Mount modular API routers
app.use('/api/auth', authRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api', postsRoutes);
app.use('/api', mediaRoutes);
app.use('/api', userRoutes);

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
    return res.sendFile(spaIndexPath);
  }
  res.status(404).send(`index.html not found. CWD: ${process.cwd()}`);
});

// Start the HTTP server for local runs
function startServer(port) {
  const srv = app.listen(port, async () => {
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

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[!] Порт ${port} занят, пробуем порт ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Ошибка запуска сервера:', err);
    }
  });
}

if (!isServerless) {
  initBackupScheduler();
  startServer(Number(PORT));
}

export default app;
