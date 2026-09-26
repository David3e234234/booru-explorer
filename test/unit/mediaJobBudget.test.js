import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMediaJob } from '../../src/services/mediaJobSupervisor.js';

// Thumbnails and transcodes draw from independent budgets: a saturated
// transcode pool must not delay thumbnail jobs (and vice versa).
describe('media job budgets', () => {
  it('runs thumbnail jobs while both transcode slots are busy', async () => {
    let resolveBlocked;
    const blocked = new Promise((resolve) => { resolveBlocked = resolve; });
    // runMediaJob settles when the task finishes, so while the blocked tasks
    // are pending both transcode slots stay held.
    const transcodeJobs = [runMediaJob(() => blocked, 'transcode'), runMediaJob(() => blocked, 'transcode')];

    let thumbnailRan = false;
    const thumbnailJob = runMediaJob(async () => { thumbnailRan = true; }, 'thumbnail');
    // Let the thumbnail job reach its task body
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(thumbnailRan, true, 'thumbnail must start behind the busy transcode pool');

    resolveBlocked();
    await Promise.all(transcodeJobs);
    await thumbnailJob;
  });

  it('queues thumbnail jobs beyond their own concurrency', async () => {
    let running = 0;
    let maxRunning = 0;
    const gate = () => new Promise((resolve) => setImmediate(resolve));
    const jobs = [];
    for (let i = 0; i < 8; i++) {
      jobs.push(runMediaJob(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await gate();
        running -= 1;
      }, 'thumbnail'));
    }
    await gate();
    assert.ok(maxRunning > 1 && maxRunning <= 6, `expected bounded parallelism, got ${maxRunning}`);
    await Promise.all(jobs);
  });

  it('rejects with 503 when the transcode queue is full', async () => {
    const blockers = [runMediaJob(() => new Promise(() => {}), 'transcode'), runMediaJob(() => new Promise(() => {}), 'transcode')];
    // 31 jobs fill the queue up to (but not past) its budget
    const queued = [];
    for (let i = 0; i < 31; i++) queued.push(runMediaJob(() => new Promise(() => {}), 'transcode'));
    const probe = runMediaJob(() => new Promise(() => {}), 'transcode');
    const probeOutcome = await Promise.race([
      probe.then(() => 'started', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve('queued'), 50))
    ]);
    assert.equal(probeOutcome, 'queued');
    // The next job overflows the queue and is rejected
    const overflow = await runMediaJob(() => new Promise(() => {}), 'transcode').catch((err) => err);
    assert.equal(overflow && overflow.statusCode, 503);
    for (const job of [...blockers, ...queued]) job.catch(() => {});
  });
});
