import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

export function createMockAgent() {
  const originalDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return { agent, originalDispatcher };
}

export function restoreDispatcher(originalDispatcher, agent) {
  try {
    if (agent && typeof agent.destroy === 'function') {
      agent.destroy();
    } else if (agent && typeof agent.close === 'function') {
      agent.close();
    }
  } catch {}
  if (originalDispatcher) {
    setGlobalDispatcher(originalDispatcher);
  }
}

export function assertNormalizedPost(post, expectedSite = null) {
  assert.ok(post, 'Post object must not be null or undefined');
  assert.equal(typeof post, 'object', 'Post must be an object');

  // Mandatory 14 fields
  const mandatoryFields = [
    'id', 'originalId', 'site', 'siteName',
    'fileUrl', 'sampleUrl', 'previewUrl',
    'thumb180', 'thumb360', 'thumb720',
    'isVideo', 'hasSound', 'tags', 'rating'
  ];

  for (const field of mandatoryFields) {
    assert.ok(field in post, `Post missing mandatory field: "${field}"`);
  }

  assert.equal(typeof post.id, 'string', 'post.id must be a string');
  assert.ok(post.id.length > 0, 'post.id must not be empty');
  assert.equal(typeof post.originalId, 'string', 'post.originalId must be a string');
  assert.ok(post.originalId.length > 0, 'post.originalId must not be empty');
  assert.equal(typeof post.site, 'string', 'post.site must be a string');
  if (expectedSite) {
    assert.equal(post.site, expectedSite, `post.site should match "${expectedSite}"`);
  }
  assert.equal(typeof post.siteName, 'string', 'post.siteName must be a string');

  // URL fields
  assert.equal(typeof post.fileUrl, 'string', 'post.fileUrl must be a string');
  assert.equal(typeof post.sampleUrl, 'string', 'post.sampleUrl must be a string');
  assert.equal(typeof post.previewUrl, 'string', 'post.previewUrl must be a string');

  // Thumb tiers
  assert.equal(typeof post.thumb180, 'string', 'post.thumb180 must be a string');
  assert.equal(typeof post.thumb360, 'string', 'post.thumb360 must be a string');
  assert.equal(typeof post.thumb720, 'string', 'post.thumb720 must be a string');

  // Thumb fallback cascade check: if any media URL exists, thumb tiers must not all be blank
  if (post.fileUrl || post.sampleUrl || post.previewUrl) {
    assert.ok(post.thumb180.length > 0, 'post.thumb180 must not be empty when media URL exists');
    assert.ok(post.thumb360.length > 0, 'post.thumb360 must not be empty when media URL exists');
    assert.ok(post.thumb720.length > 0, 'post.thumb720 must not be empty when media URL exists');
  }

  // Boolean flags
  assert.equal(typeof post.isVideo, 'boolean', 'post.isVideo must be a boolean');
  assert.equal(typeof post.hasSound, 'boolean', 'post.hasSound must be a boolean');

  // Tags & Rating
  assert.ok(Array.isArray(post.tags), 'post.tags must be an array');
  assert.equal(typeof post.rating, 'string', 'post.rating must be a string');
  assert.ok(['g', 's', 'q', 'e'].includes(post.rating), `post.rating must be one of g, s, q, e, got: "${post.rating}"`);
}
