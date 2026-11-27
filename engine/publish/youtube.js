import fs from 'node:fs/promises';
import { secret, optionalSecret } from '../lib/config.js';
import { log } from '../lib/log.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

export async function youtubeAccessToken(config, brand) {
  const body = new URLSearchParams({
    client_id: secret(config, brand, 'youtube', 'clientId'),
    client_secret: secret(config, brand, 'youtube', 'clientSecret'),
    refresh_token: secret(config, brand, 'youtube', 'refreshToken'),
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `YouTube token refresh failed (${res.status} ${json.error || ''}). Reconnect the account — testing-mode tokens expire weekly.`,
    );
  }
  return json.access_token;
}

const clip = (s, n) => String(s || '').slice(0, n);

export function youtubeMetadata(brand, item, privacyStatus = 'public', categoryId = '28') {
  const title = clip(`${item.hook} #Shorts`, 100);
  const description = clip(
    [item.caption, '', (item.hashtags || []).join(' '), '', brand.endCard?.subtitle || '']
      .filter(Boolean)
      .join('\n'),
    4900,
  );
  return {
    snippet: {
      title,
      description,
      tags: (item.hashtags || []).map((h) => String(h).replace('#', '')).slice(0, 15),
      categoryId,
    },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };
}

export async function publishYouTube({ config, brand, item, file, dryRun }) {
  const settings = brand.platforms.youtube || {};
  const metadata = youtubeMetadata(
    brand,
    item,
    settings.privacyStatus || 'public',
    settings.categoryId || '28',
  );

  if (dryRun) {
    log(`[dry-run] YouTube upload: "${metadata.snippet.title}" (${(await fs.stat(file)).size} bytes)`);
    return { ok: true, dryRun: true, id: 'dry-run', url: null };
  }

  const token = await youtubeAccessToken(config, brand);
  const data = await fs.readFile(file);

  const initRes = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(data.length),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    throw new Error(`YouTube upload start failed (${initRes.status}): ${await initRes.text()}`);
  }
  const location = initRes.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload URL.');

  const putRes = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(data.length) },
    body: data,
  });
  const video = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !video.id) {
    throw new Error(`YouTube upload failed (${putRes.status}): ${JSON.stringify(video).slice(0, 300)}`);
  }

  const playlist = optionalSecret(config, brand, 'youtube', 'playlistId') || settings.playlistId;
  if (playlist) {
    await fetch(`${API}/playlistItems?part=snippet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { playlistId: playlist, resourceId: { kind: 'youtube#video', videoId: video.id } },
      }),
    }).catch(() => {});
  }

  log(`YouTube: https://youtube.com/shorts/${video.id}`);
  return { ok: true, id: video.id, url: `https://youtube.com/shorts/${video.id}` };
}

export async function youtubeStats(config, brand, ids) {
  if (!ids.length) return {};
  const token = await youtubeAccessToken(config, brand);
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`${API}/videos?part=statistics&id=${chunk.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`YouTube stats failed (${res.status})`);
    for (const v of json.items || []) {
      out[v.id] = {
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
        comments: Number(v.statistics?.commentCount || 0),
      };
    }
  }
  return out;
}
