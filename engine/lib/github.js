import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './log.js';

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

const repo = () => process.env.GITHUB_REPOSITORY || '';
const token = () => process.env.GITHUB_TOKEN || '';

async function gh(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'shorts-engine',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || res.statusText;
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return { body, headers: res.headers };
}

async function findRelease(tag) {
  try {
    const { body } = await gh(`${API}/repos/${repo()}/releases/tags/${tag}`);
    return body;
  } catch {
    return null;
  }
}

async function createRelease(tag) {
  const { body } = await gh(`${API}/repos/${repo()}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `Daily shorts ${tag}`,
      body: 'Auto-generated candidates. Each file is a vertical short awaiting approval.',
      draft: false,
      prerelease: false,
    }),
  });
  return body;
}

/**
 * Uploads one rendered file and returns a public URL.
 * Release assets are public on a public repo and need no domain or server.
 */
export async function uploadRender(file, tag, name) {
  if (!repo() || !token()) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required to publish video URLs');
  }
  const release = (await findRelease(tag)) || (await createRelease(tag));

  // A rebuilt candidate must replace the file with the same name, otherwise the queue
  // keeps pointing at the old video.
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    await gh(`${API}/repos/${repo()}/releases/assets/${existing.id}`, { method: 'DELETE' }).catch(() => {});
    log(`replacing asset: ${name}`);
  }

  const data = await fs.readFile(file);
  const url = `${UPLOADS}/repos/${repo()}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'video/mp4',
      'Content-Length': String(data.length),
      'User-Agent': 'shorts-engine',
    },
    body: data,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub upload ${res.status}: ${body.message || ''}`);
  log(`uploaded ${name} (${(data.length / 1048576).toFixed(1)} MB)`);
  return body.browser_download_url;
}

/** Keeps only the last few days of render releases so the repo never balloons. */
export async function pruneOldRenders(keepDays = 4) {
  if (!repo() || !token()) return 0;
  const { body: releases } = await gh(`${API}/repos/${repo()}/releases?per_page=100`);
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const r of releases) {
    if (!String(r.tag_name || '').startsWith('renders-')) continue;
    const when = new Date(r.created_at).getTime();
    if (when >= cutoff) continue;
    try {
      await gh(`${API}/repos/${repo()}/releases/${r.id}`, { method: 'DELETE' });
      removed++;
    } catch (e) {
      log(`could not prune ${r.tag_name}: ${e.message}`);
    }
  }
  if (removed) log(`pruned ${removed} old render release(s)`);
  return removed;
}

export const renderTag = (day) => `renders-${day.replaceAll('-', '')}`;

export const assetName = (id) => `${path.basename(id, '.mp4')}.mp4`;
