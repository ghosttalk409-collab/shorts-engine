import { secret } from '../lib/config.js';
import { log } from '../lib/log.js';

const BASE = 'https://graph.facebook.com';

const version = (brand) => brand.platforms?.facebook?.apiVersion || 'v21.0';

async function graph(path, { token, params = {}, method = 'GET' }) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: method === 'POST' ? url.searchParams : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`Instagram ${res.status}: ${msg}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Instagram fetches the video from a public HTTPS URL, so this platform needs
 * item.videoUrl (the release asset). It cannot accept raw bytes here.
 */
export async function publishInstagram({ brand, item, dryRun }) {
  if (!item.videoUrl) {
    throw new Error('Instagram needs a public video URL (videoUrl). Check the render upload step.');
  }
  if (dryRun) {
    log(`[dry-run] Instagram Reel: ${item.videoUrl}`);
    return { ok: true, dryRun: true, id: 'dry-run', url: null };
  }

  const igUserId = secret(null, brand, 'instagram', 'igUserId');
  const token = secret(null, brand, 'instagram', 'token');
  const v = version(brand);

  const container = await graph(`${v}/${igUserId}/media`, {
    method: 'POST',
    token,
    params: {
      media_type: 'REELS',
      video_url: item.videoUrl,
      caption: item.caption,
      share_to_feed: brand.platforms?.instagram?.shareToFeed === false ? 'false' : 'true',
      access_token: token,
    },
  });

  let status = 'IN_PROGRESS';
  for (let attempt = 0; attempt < 10 && status === 'IN_PROGRESS'; attempt++) {
    await sleep(30_000);
    const check = await graph(`${v}/${container.id}`, {
      token,
      params: { fields: 'status_code,status', access_token: token },
    });
    status = check.status_code || 'IN_PROGRESS';
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram processing failed: ${check.status || status}`);
    }
  }
  if (status !== 'FINISHED') throw new Error(`Instagram container still ${status} after 5 minutes`);

  const published = await graph(`${v}/${igUserId}/media_publish`, {
    method: 'POST',
    token,
    params: { creation_id: container.id, access_token: token },
  });

  let permalink = null;
  try {
    const info = await graph(`${v}/${published.id}`, {
      token,
      params: { fields: 'permalink', access_token: token },
    });
    permalink = info.permalink;
  } catch {
    /* permalink is nice-to-have */
  }

  log(`Instagram: ${permalink || published.id}`);
  return { ok: true, id: published.id, url: permalink };
}

export async function instagramStats({ brand, ids }) {
  const token = secret(null, brand, 'instagram', 'token');
  const v = version(brand);
  const out = {};
  for (const id of ids) {
    for (const metric of ['views,likes,comments,saved,shares', 'likes,comments']) {
      try {
        const json = await graph(`${v}/${id}/insights`, { token, params: { metric, access_token: token } });
        const row = {};
        for (const d of json.data || []) {
          const value = d.values?.[0]?.value ?? d.total_value?.value ?? 0;
          row[d.name] = Number(value || 0);
        }
        out[id] = {
          views: row.views || 0,
          likes: row.likes || 0,
          comments: row.comments || 0,
          saves: row.saved || 0,
          shares: row.shares || 0,
        };
        break;
      } catch (e) {
        out[id] = out[id] || { views: 0, likes: 0, comments: 0 };
      }
    }
  }
  return out;
}
