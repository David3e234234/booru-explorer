import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, recordPostHistory, loadViewHistory, clearViewHistory } from '../../public/js/state.js';

// state.js wraps every localStorage touch in try/catch, so the suite runs in
// plain Node without a storage shim; only the in-memory list is asserted.
// clearViewHistory() also cancels the pending debounce timer, keeping the
// runner's event loop free after the suite finishes.
describe('Client view history', () => {
  beforeEach(() => clearViewHistory());

  it('stores a compact entry per post and puts the newest first', () => {
    recordPostHistory({ id: 'danbooru:1', site: 'danbooru', thumb360: 'https://cdn.example/th/1.jpg', isVideo: false });
    recordPostHistory({ id: 'gelbooru:2', site: 'gelbooru', previewUrl: 'https://cdn.example/th/2.jpg', isVideo: true });
    assert.strictEqual(state.viewHistory.length, 2);
    assert.strictEqual(state.viewHistory[0].i, 'gelbooru:2');
    const entry = state.viewHistory[1];
    assert.strictEqual(entry.i, 'danbooru:1');
    assert.strictEqual(entry.s, 'danbooru');
    assert.strictEqual(entry.t, 'https://cdn.example/th/1.jpg');
    assert.strictEqual(entry.v, 0);
    assert.ok(Number.isFinite(entry.ts));
    assert.strictEqual(state.viewHistory[0].v, 1);
  });

  it('moves a re-viewed post to the front instead of duplicating it', () => {
    recordPostHistory({ id: 'a', site: 'danbooru' });
    recordPostHistory({ id: 'b', site: 'danbooru' });
    recordPostHistory({ id: 'a', site: 'danbooru' });
    assert.strictEqual(state.viewHistory.length, 2);
    assert.strictEqual(state.viewHistory[0].i, 'a');
  });

  it('keeps originalId only when it differs from the client id', () => {
    recordPostHistory({ id: 'x1', originalId: 'x1', site: 'danbooru' });
    recordPostHistory({ id: 'danbooru:9', originalId: '9', site: 'danbooru' });
    assert.strictEqual(state.viewHistory[0].o, '9');
    assert.strictEqual(state.viewHistory[1].o, undefined);
  });

  it('caps the list at 500 entries, dropping the oldest', () => {
    for (let k = 0; k < 520; k++) {
      recordPostHistory({ id: 'p' + k, site: 'danbooru' });
    }
    assert.strictEqual(state.viewHistory.length, 500);
    assert.strictEqual(state.viewHistory[0].i, 'p519');
    assert.strictEqual(state.viewHistory[499].i, 'p20');
  });

  it('ignores posts without id or site', () => {
    recordPostHistory(null);
    recordPostHistory({ id: 'x' });
    recordPostHistory({ site: 'danbooru' });
    assert.strictEqual(state.viewHistory.length, 0);
  });

  it('clears the list and stays safe without localStorage', () => {
    recordPostHistory({ id: 'q', site: 'danbooru' });
    clearViewHistory();
    assert.strictEqual(state.viewHistory.length, 0);
    assert.deepStrictEqual(loadViewHistory(), []);
  });
});
