const MAX_CONCURRENT_MEDIA_JOBS = 2;
const MAX_QUEUED_MEDIA_JOBS = 32;

let active = 0;
const queue = [];

function release() {
  active -= 1;
  const next = queue.shift();
  if (!next) return;
  active += 1;
  next.start();
}

export function acquireMediaJobSlot() {
  if (active >= MAX_CONCURRENT_MEDIA_JOBS) {
    if (queue.length >= MAX_QUEUED_MEDIA_JOBS) {
      const error = new Error('Очередь обработки видео переполнена');
      error.statusCode = 503;
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      queue.push({
        start() {
          active += 1;
          resolve(() => release());
        }
      });
    });
  }
  active += 1;
  return Promise.resolve(() => release());
}

export function runMediaJob(task) {
  return acquireMediaJobSlot().then((release) => {
    return Promise.resolve()
      .then(task)
      .finally(release);
  });
}
