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

export function getFfmpegHeaders(targetUrl, currentSettings = {}) {
  let referer = 'https://danbooru.donmai.us/';
  let authHeader = '';
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('rule34video.com')) referer = 'https://rule34video.com/';
    else if (parsed.hostname.includes('paheal.net') || parsed.hostname.includes('paheal-cdn.net')) referer = 'https://rule34.paheal.net/';
    else if (parsed.hostname.includes('rule34.xxx')) referer = 'https://rule34.xxx/';
    else if (parsed.hostname.includes('donmai.us')) {
      referer = 'https://danbooru.donmai.us/';
      if (currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
        authHeader = `Authorization: Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}\r\n`;
      }
    } else if (parsed.hostname.includes('yande.re')) referer = 'https://yande.re/';
    else if (parsed.hostname.includes('konachan')) referer = 'https://konachan.net/';
    else if (parsed.hostname.includes('gelbooru.com')) referer = 'https://gelbooru.com/';
    else if (parsed.hostname.includes('safebooru.org')) referer = 'https://safebooru.org/';
    else if (parsed.hostname.includes('xbooru.com')) referer = 'https://xbooru.com/';
    else if (parsed.hostname.includes('hypnohub.net')) referer = 'https://hypnohub.net/';
    else referer = `${parsed.protocol}//${parsed.host}/`;
  } catch {}
  return `User-Agent: ${BROWSER_USER_AGENT}\r\nReferer: ${referer}\r\n${authHeader}`;
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
