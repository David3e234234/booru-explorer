// Thumbnails and transcodes share nothing but FFmpeg: a frame extraction is
// I/O-bound (one bounded download, cheap filter), a transcode burns CPU for
// minutes. One global budget let a pair of long transcodes stall every card
// thumbnail behind them, so each kind gets its own concurrency and queue.
const MEDIA_JOB_BUDGETS = {
  transcode: { maxConcurrent: 2, maxQueued: 32 },
  thumbnail: { maxConcurrent: 6, maxQueued: 48 },
};

const budgets = new Map();

function release(kind) {
  const state = budgets.get(kind);
  if (!state) return;
  state.active -= 1;
  const next = state.queue.shift();
  if (!next) return;
  state.active += 1;
  next.start();
}

export function acquireMediaJobSlot(kind = 'transcode') {
  const budget = MEDIA_JOB_BUDGETS[kind] || MEDIA_JOB_BUDGETS.transcode;
  if (!budgets.has(kind)) budgets.set(kind, { active: 0, queue: [] });
  const state = budgets.get(kind);
  if (state.active >= budget.maxConcurrent) {
    if (state.queue.length >= budget.maxQueued) {
      const error = new Error('Очередь обработки видео переполнена');
      error.statusCode = 503;
      return Promise.reject(error);
    }
    return new Promise((resolve) => {
      state.queue.push({
        start() {
          state.active += 1;
          resolve(() => release(kind));
        }
      });
    });
  }
  state.active += 1;
  return Promise.resolve(() => release(kind));
}

export function runMediaJob(task, kind = 'transcode') {
  return acquireMediaJobSlot(kind).then((release) => {
    return Promise.resolve()
      .then(task)
      .finally(release);
  });
}
