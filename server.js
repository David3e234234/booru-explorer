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
  ROOT_DIR 
} from './src/config/constants.js';
import postsRoutes from './src/routes/posts.routes.js';
import mediaRoutes from './src/routes/media.routes.js';
import userRoutes from './src/routes/user.routes.js';
import authRoutes from './src/routes/auth.routes.js';
import { initBackupScheduler } from './src/services/backupService.js';

// Принудительный выбор IPv4 в первую очередь для надежных сетевых запросов к зарубежным Booru
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const app = express();

// Защита от аварийного падения сервера при разрывах сетевых потоков
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET' || err.message?.includes('terminated') || err.message?.includes('aborted')) {
    return;
  }
  console.error('[Process UncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process UnhandledRejection]', reason);
});

// Инициализация директорий хранилища и кэша
[DATA_DIR, CACHE_DIR, THUMBS_DIR, VIDEOS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[FS Warning] Не удалось создать папку ${dir}:`, err.message);
  }
});

// Глобальные middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Отключение кэширования только для API (статика кэшируется браузером)
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Статика фронтенда: etag + час кэша (раньше был полный запрет кэша —
// браузер заново скачивал все бандлы при каждом визите)
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

// Подключение модульных роутеров API
app.use('/api/auth', authRoutes);
app.use('/api', postsRoutes);
app.use('/api', mediaRoutes);
app.use('/api', userRoutes);

// SPA Fallback: отдача index.html для всех не-API страниц
let spaIndexPath = null;

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  // Путь резолвится один раз, а не четырьмя existsSync на каждый запрос
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

// Запуск HTTP-сервера для локального запуска
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
