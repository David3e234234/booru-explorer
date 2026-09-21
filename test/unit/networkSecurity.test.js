import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeExternalUrl, isSafeExternalUrlResolved } from '../../src/utils/network.js';

describe('isSafeExternalUrl (SSRF guard)', () => {
  it('should reject loopback, private and metadata addresses', () => {
    assert.strictEqual(isSafeExternalUrl('http://127.0.0.1/'), false);
    assert.strictEqual(isSafeExternalUrl('http://127.0.0.1:8080/x.jpg'), false);
    assert.strictEqual(isSafeExternalUrl('http://10.0.0.5/'), false);
    assert.strictEqual(isSafeExternalUrl('http://192.168.1.1/'), false);
    assert.strictEqual(isSafeExternalUrl('http://172.16.0.1/'), false);
    assert.strictEqual(isSafeExternalUrl('http://169.254.169.254/latest/meta-data/'), false);
    assert.strictEqual(isSafeExternalUrl('http://0.0.0.0/'), false);
    assert.strictEqual(isSafeExternalUrl('http://localhost/'), false);
    assert.strictEqual(isSafeExternalUrl('http://metadata.google.internal/'), false);
  });

  it('should reject a host whose root dot hides a local name', () => {
    assert.strictEqual(isSafeExternalUrl('http://localhost./'), false);
    assert.strictEqual(isSafeExternalUrl('http://LOCALHOST.:3000/'), false);
    assert.strictEqual(isSafeExternalUrl('http://127.0.0.1./'), false);
    assert.strictEqual(isSafeExternalUrl('http://foo.local./'), false);
    assert.strictEqual(isSafeExternalUrl('http://intranet/'), false);
  });

  it('should reject IPv6 loopback, unique-local, link-local and multicast', () => {
    assert.strictEqual(isSafeExternalUrl('http://[::1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[::]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[fc00::1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[fd12:3456::1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[fe80::1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[ff02::1]/'), false);
  });

  it('should reject IPv4 addresses embedded in an IPv6 address', () => {
    // WHATWG URL prints the mapped form in hex, which a dotted-quad regex misses
    assert.strictEqual(isSafeExternalUrl('http://[::ffff:7f00:1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[::ffff:127.0.0.1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[::ffff:a9fe:a9fe]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[::ffff:a00:1]/'), false);
    assert.strictEqual(isSafeExternalUrl('http://[2002:7f00:1::]/'), false);   // 6to4 -> 127.0.0.1
    assert.strictEqual(isSafeExternalUrl('http://[64:ff9b::a9fe:a9fe]/'), false); // NAT64 -> metadata
    assert.strictEqual(isSafeExternalUrl('http://[::127.0.0.1]/'), false);     // deprecated compatible form
    assert.strictEqual(isSafeExternalUrl('http://[::ffff:8.8.8.8]/'), true);   // mapped public address
  });

  it('should reject alternate spellings of a loopback IPv4 address', () => {
    assert.strictEqual(isSafeExternalUrl('http://2130706433/'), false);
    assert.strictEqual(isSafeExternalUrl('http://0x7f.0.0.1/'), false);
    assert.strictEqual(isSafeExternalUrl('http://0177.0.0.1/'), false);
  });

  it('should accept public booru URLs', () => {
    assert.strictEqual(isSafeExternalUrl('https://danbooru.donmai.us/posts.json'), true);
    assert.strictEqual(isSafeExternalUrl('https://cdn.donmai.us/original/ab/cd/abcdef.jpg'), true);
    assert.strictEqual(isSafeExternalUrl('https://yande.re/post.json?tags=solo'), true);
    assert.strictEqual(isSafeExternalUrl('https://kemono.cr/api/v1/posts'), true);
    assert.strictEqual(isSafeExternalUrl('http://[2606:4700:4700::1111]/dns-query'), true);
    assert.strictEqual(isSafeExternalUrl('http://93.184.216.34/video.mp4'), true);
  });

  it('should reject non-http(s) schemes and malformed input', () => {
    assert.strictEqual(isSafeExternalUrl('ftp://example.com/x.jpg'), false);
    assert.strictEqual(isSafeExternalUrl('file:///etc/passwd'), false);
    assert.strictEqual(isSafeExternalUrl('javascript:alert(1)'), false);
    assert.strictEqual(isSafeExternalUrl('data:text/html,<h1>x</h1>'), false);
    assert.strictEqual(isSafeExternalUrl('not a url'), false);
    assert.strictEqual(isSafeExternalUrl(''), false);
    assert.strictEqual(isSafeExternalUrl(null), false);
    assert.strictEqual(isSafeExternalUrl(undefined), false);
    assert.strictEqual(isSafeExternalUrl(12345), false);
  });
});

describe('isSafeExternalUrlResolved (SSRF guard with hostname resolution)', () => {
  it('should reject literal local targets without a resolver round trip', async () => {
    assert.strictEqual(await isSafeExternalUrlResolved('http://127.0.0.1/'), false);
    assert.strictEqual(await isSafeExternalUrlResolved('http://[::ffff:7f00:1]/'), false);
    assert.strictEqual(await isSafeExternalUrlResolved('http://localhost./'), false);
    assert.strictEqual(await isSafeExternalUrlResolved('file:///etc/passwd'), false);
  });
});
