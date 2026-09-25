// Resolves the board session token for the Kemono-family sites.
//
// Access is token-only: the operator pastes their own `session` cookie value.
// There is no credential exchange here, so nothing is stored, cached or
// single-flighted, and no login request can ever be triggered by a gallery
// page firing dozens of parallel requests.

/**
 * Accepts a bare token, `session=token` or a pasted cookie jar and returns the
 * bare token. The parsers already had three divergent copies of this logic.
 */
export function extractSessionToken(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const match = value.match(/(?:^|;\s*)session=([^;]+)/i);
  const token = (match ? match[1] : value).trim().replace(/^["']|["']$/g, '');
  return token.startsWith('session=') ? '' : token;
}

/**
 * Returns `{ token, username }` for a board session, normalized from whatever
 * the operator pasted into the site setting.
 */
export async function resolveSiteSession(site, settings = {}) {
  const token = extractSessionToken(settings[`${site}Session`]);
  return { token, username: '' };
}

/**
 * Kept for the parsers' 401 recovery path. With no credential exchange there is
 * nothing cached to drop: a rejected token stays rejected until the operator
 * pastes a fresh one, so re-reading the setting is the whole recovery.
 */
export function invalidateSiteSession() {}

// Retained as a no-op. The cache it used to clear is gone, but the parser test
// suites call this between cases to isolate module-level state.
export function clearSiteSessionCache() {}
