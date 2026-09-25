export function normalizeHostname(rawHost) {
  let host = String(rawHost || '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function hostnameMatches(hostname, domain) {
  const host = normalizeHostname(hostname);
  const base = normalizeHostname(domain);
  return host === base || host.endsWith(`.${base}`);
}

export function isDanbooruCredentialHost(hostname) {
  return normalizeHostname(hostname) === 'danbooru.donmai.us';
}

const SITE_DOMAINS = [
  ['danbooru', ['donmai.us']],
  ['gelbooru', ['gelbooru.com']],
  ['rule34', ['rule34.xxx', 'paheal.net', 'paheal-cdn.net']],
  ['rule34video', ['rule34video.com', 'boomio-cdn.com']],
  ['yandere', ['yande.re']],
  ['konachan', ['konachan.net', 'konachan.com']],
  ['safebooru', ['safebooru.org']],
  ['xbooru', ['xbooru.com']],
  ['hypnohub', ['hypnohub.net']],
  ['tbib', ['tbib.org']],
  ['pawchive', ['pawchive.pw', 'pawchive.st']],
  ['kemono', ['kemono.cr', 'kemono.su', 'kemono.party', 'coomer.st', 'coomer.su', 'coomer.party']]
];

export function siteFromHostname(hostname) {
  const host = normalizeHostname(hostname);
  for (const [site, domains] of SITE_DOMAINS) {
    if (domains.some(domain => hostnameMatches(host, domain))) return site;
  }
  return null;
}

export function sanitizeLogUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(rawUrl || '').split('?')[0].split('#')[0];
  }
}
