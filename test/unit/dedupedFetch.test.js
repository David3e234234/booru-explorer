import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupedFetch, inFlightRequests } from '../../public/js/api.js';

describe('dedupedFetch', () => {
  it('deduplicates concurrent fetches and clones responses so bodies can be consumed multiple times', async () => {
    let fetchCalls = 0;
    const mockPayload = { success: true, items: [1, 2, 3] };

    const mockFetch = async () => {
      fetchCalls++;
      // Yield to event loop to simulate network latency
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify(mockPayload), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    };

    const key = '/test/concurrent-endpoint';

    // Launch two concurrent requests for the same key
    const promise1 = dedupedFetch(key, mockFetch);
    const promise2 = dedupedFetch(key, mockFetch);

    assert.strictEqual(inFlightRequests.has(key), true);

    const [res1, res2] = await Promise.all([promise1, promise2]);

    assert.strictEqual(fetchCalls, 1, 'underlying fetch should only be invoked once');
    assert.notStrictEqual(res1, res2, 'each consumer should receive an independent Response clone');

    // Both consumers must be able to consume the body stream without TypeError: Body has already been consumed
    const json1 = await res1.json();
    const json2 = await res2.json();

    assert.deepStrictEqual(json1, mockPayload);
    assert.deepStrictEqual(json2, mockPayload);

    // After resolution, in-flight map should be cleaned up
    assert.strictEqual(inFlightRequests.has(key), false);
  });

  it('cleans up inFlightRequests when fetch fails', async () => {
    const key = '/test/failure-endpoint';
    const mockFailingFetch = async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      throw new Error('Network error');
    };

    const p1 = dedupedFetch(key, mockFailingFetch);
    const p2 = dedupedFetch(key, mockFailingFetch);

    await assert.rejects(p1, { message: 'Network error' });
    await assert.rejects(p2, { message: 'Network error' });

    assert.strictEqual(inFlightRequests.has(key), false);
  });
});
