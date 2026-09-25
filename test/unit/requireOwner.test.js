import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const previousDataDir = process.env.BOORU_DATA_DIR;
const previousAdminToken = process.env.BOORU_ADMIN_TOKEN;
let tmpDir;
let requireOwner;
let registerUser;
let ownerToken = '';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function call(req) {
  const res = makeRes();
  let passed = false;
  requireOwner(req, res, () => { passed = true; });
  return { res, passed };
}

describe('Owner guard', () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'booru-owner-'));
    process.env.BOORU_DATA_DIR = tmpDir;
    delete process.env.BOORU_ADMIN_TOKEN;
    const userService = await import('../../src/services/userService.js');
    requireOwner = userService.requireOwner;
    registerUser = userService.registerUser;
  });

  after(async () => {
    if (previousDataDir) process.env.BOORU_DATA_DIR = previousDataDir;
    else delete process.env.BOORU_DATA_DIR;
    if (previousAdminToken === undefined) delete process.env.BOORU_ADMIN_TOKEN;
    else process.env.BOORU_ADMIN_TOKEN = previousAdminToken;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects anonymous callers', () => {
    const { res, passed } = call({ headers: {} });
    assert.strictEqual(passed, false);
    assert.strictEqual(res.statusCode, 401);
  });

  it('rejects a session that is not the owner when no token is configured', async () => {
    const owner = await registerUser('owner', 'owner-password-1');
    ownerToken = owner.token;
    const second = await registerUser('second', 'second-password-1');
    assert.ok(second.token);

    const { res, passed } = call({ headers: { authorization: `Bearer ${second.token}` } });
    assert.strictEqual(passed, false);
    assert.strictEqual(res.statusCode, 403);
  });

  it('accepts the owner session when no token is configured', async () => {
    // The first registered account owns the deployment when no token is set.
    const { res, passed } = call({ headers: { authorization: `Bearer ${ownerToken}` } });
    assert.strictEqual(passed, true);
    assert.strictEqual(res.statusCode, 200);
  });

  it('accepts a bare admin token without a session', () => {
    process.env.BOORU_ADMIN_TOKEN = 'super-secret-token';
    try {
      const { res, passed } = call({ headers: { 'x-booru-admin-token': 'super-secret-token' } });
      assert.strictEqual(passed, true);
      assert.strictEqual(res.statusCode, 200);
    } finally {
      delete process.env.BOORU_ADMIN_TOKEN;
    }
  });

  it('rejects a wrong or missing admin token', () => {
    process.env.BOORU_ADMIN_TOKEN = 'super-secret-token';
    try {
      const wrong = call({ headers: { 'x-booru-admin-token': 'wrong-token-value' } });
      assert.strictEqual(wrong.passed, false);
      assert.strictEqual(wrong.res.statusCode, 401);

      const missing = call({ headers: {} });
      assert.strictEqual(missing.passed, false);
      assert.strictEqual(missing.res.statusCode, 401);
    } finally {
      delete process.env.BOORU_ADMIN_TOKEN;
    }
  });
});
