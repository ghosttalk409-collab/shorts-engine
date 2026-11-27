import { secret } from '../lib/config.js';
import { log } from '../lib/log.js';

const BASE = 'https://graph.facebook.com';

const version = (brand) => brand.platforms?.facebook?.apiVersion || 'v21.0';

async function post(path, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') body.set(k, String(v));
  }
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`Facebook ${res.status}: ${msg}`);
  }
  return json;
}

export async function publishFacebook({ brand, item, dryRun }) {
  if (!item.videoUrl) {
    throw new Error('Facebook needs a public video URL (videoUrl). Check the render upload step.');
  }
  if (dryRun) {
    log(`[dry-run] Facebook video: ${item.videoUrl}`);
    return { ok: true, dryRun: true, id: 'dry-run', url: null };
  }

  const pageId = secret(null, brand, 'facebook', 'pageId');
  const token = secret(null, brand, 'facebook', 'token');
  const v = version(brand);

  const json = await post(`${v}/${pageId}/videos`, {
    file_url: item.videoUrl,
    title: item.hook,
    description: item.caption,
    access_token: token,
  });

  log(`Facebook: ${json.id}`);
  return { ok: true, id: json.id, url: `https://facebook.com/${json.id}` };
}

export async function facebookStats({ brand, ids }) {
  const token = secret(null, brand, 'facebook', 'token');
  const v = version(brand);
  const out = {};
  for (const id of ids) {
    try {
      const url = new URL(`${BASE}/${v}/${id}/video_insights`);
      url.searchParams.set('metric', 'total_video_views,total_video_reactions_by_type_total');
      url.searchParams.set('access_token', token);
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      const row = {};
      for (const d of json.data || []) {
        const val = d.values?.[0]?.value;
        row[d.name] = typeof val === 'number' ? val : Object.values(val || {}).reduce((s, n) => s + Number(n || 0), 0);
      }
      out[id] = { views: row.total_video_views || 0, likes: row.total_video_reactions_by_type_total || 0, comments: 0 };
    } catch {
      out[id] = { views: 0, likes: 0, comments: 0 };
    }
  }
  return out;
}
