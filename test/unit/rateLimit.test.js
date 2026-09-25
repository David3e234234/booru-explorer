import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../../src/middleware/rateLimit.js';

function makeReq(ip) {
  return { ip, socket: { remoteAddress: ip } };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

describe('Rate limiter', () => {
  it('limits per client within one limiter', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    let nextCalls = 0;
    const next = () => { nextCalls += 1; };

    limiter(makeReq('10.0.0.1'), makeRes(), next);
    limiter(makeReq('10.0.0.1'), makeRes(), next);
    const blocked = makeRes();
    limiter(makeReq('10.0.0.1'), blocked, next);

    assert.strictEqual(nextCalls, 2);
    assert.strictEqual(blocked.statusCode, 429);
    assert.ok(blocked.headers['Retry-After']);
  });

  it('keeps a separate budget per limiter and per client', () => {
    const strict = createRateLimiter({ windowMs: 60000, max: 1 });
    const loose = createRateLimiter({ windowMs: 60000, max: 50 });
    let strictNext = 0;
    let looseNext = 0;
    const strictPass = () => { strictNext += 1; };
    const loosePass = () => { looseNext += 1; };

    // Burn the strict limiter's only token for this client.
    strict(makeReq('10.0.0.2'), makeRes(), strictPass);
    const strictBlocked = makeRes();
    strict(makeReq('10.0.0.2'), strictBlocked, strictPass);

    // The loose limiter must not inherit that exhausted budget.
    loose(makeReq('10.0.0.2'), makeRes(), loosePass);
    loose(makeReq('10.0.0.2'), makeRes(), loosePass);

    // A different client keeps its own budget on the strict limiter.
    strict(makeReq('10.0.0.3'), makeRes(), strictPass);

    assert.strictEqual(strictNext, 2);
    assert.strictEqual(strictBlocked.statusCode, 429);
    assert.strictEqual(looseNext, 2);
  });
});
