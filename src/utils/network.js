import os from 'os';
import { BOORU_USER_AGENT, BROWSER_USER_AGENT } from '../config/constants.js';

export function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return fallback;
  }
}

export async function fetchSafe(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 25000);
  try {
    const isDanbooru = typeof url === 'string' && url.includes('donmai.us');
    const defaultUa = isDanbooru ? BOORU_USER_AGENT : BROWSER_USER_AGENT;
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': defaultUa,
        'Accept': 'application/json, text/xml, text/html, */*',
        ...(options.headers || {})
      }
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Single host -> Referer map (used by the proxy and FFmpeg)
export function resolveSiteReferer(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const h = parsed.hostname;
    if (h.includes('rule34video.com') || h.includes('boomio-cdn.com')) return 'https://rule34video.com/';
    if (h.includes('paheal.net') || h.includes('paheal-cdn.net')) return 'https://rule34.paheal.net/';
    if (h.includes('rule34.xxx')) return 'https://rule34.xxx/';
    if (h.includes('donmai.us')) return 'https://danbooru.donmai.us/';
    if (h.includes('yande.re')) return 'https://yande.re/';
    if (h.includes('konachan')) return 'https://konachan.com/';
    if (h.includes('gelbooru.com')) return 'https://gelbooru.com/';
    if (h.includes('safebooru.org')) return 'https://safebooru.org/';
    if (h.includes('xbooru.com')) return 'https://xbooru.com/';
    if (h.includes('hypnohub.net')) return 'https://hypnohub.net/';
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://danbooru.donmai.us/';
  }
}

export function getFfmpegHeaders(targetUrl, currentSettings = {}) {
  let authHeader = '';
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('donmai.us') && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
      authHeader = `Authorization: Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}\r\n`;
    }
  } catch {}
  return `User-Agent: ${BROWSER_USER_AGENT}\r\nReferer: ${resolveSiteReferer(targetUrl)}\r\n${authHeader}`;
}

export function resolvePreviewUrl(previewUrl, fileUrl, sampleUrl, isVideo) {
  const isVideoExt = (url) => {
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.zip') || clean.endsWith('.mkv') || clean.endsWith('.mov') || clean.endsWith('.m4v');
  };

  if (!previewUrl || isVideoExt(previewUrl)) {
    if (isVideo && (fileUrl || sampleUrl)) {
      return `/api/video-thumbnail?url=${encodeURIComponent(fileUrl || sampleUrl)}`;
    }
    return (!isVideo && sampleUrl && !isVideoExt(sampleUrl)) ? sampleUrl : (fileUrl || '');
  }
  return previewUrl;
}

export function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];

  const isVirtualOrVpn = (name) => {
    const lower = name.toLowerCase();
    return (
      lower.includes('radmin') ||
      lower.includes('hamachi') ||
      lower.includes('tailscale') ||
      lower.includes('zerotier') ||
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('vbox') ||
      lower.includes('vethernet') ||
      lower.includes('hyper-v') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('teredo') ||
      lower.includes('loopback') ||
      lower.includes('tap') ||
      lower.includes('tun') ||
      lower.includes('nordlynx') ||
      lower.includes('wireguard')
    );
  };

  const isPrivateIp = (ip) => {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 1;
    return 0;
  };

  for (const name of Object.keys(nets)) {
    const isVpn = isVirtualOrVpn(name);
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const priority = isPrivateIp(net.address);
        candidates.push({
          name,
          address: net.address,
          isVpn,
          priority: isVpn ? -1 : priority
        });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  if (candidates.length > 0) {
    return candidates[0].address;
  }
  return 'localhost';
}
