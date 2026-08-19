import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
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
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Статика фронтенда
app.use(express.static(path.join(ROOT_DIR, 'public'), {
  maxAge: 0,
  etag: false
}));

// Подключение модульных роутеров API
app.use('/api', postsRoutes);
app.use('/api', mediaRoutes);
app.use('/api', userRoutes);

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
  startServer(Number(PORT));
}

export default app;
