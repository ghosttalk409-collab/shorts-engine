import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, ensureDir, dayKey, hourIn } from './lib/files.js';
import {
  loadConfig,
  announceStart,
  tz,
  brandById,
  platformOn,
  checkDailyCap,
  postBlockedReason,
} from './lib/config.js';
import { loadQueue, saveQueue, approved } from './lib/state.js';
import { publishYouTube } from './publish/youtube.js';
import { publishInstagram } from './publish/instagram.js';
import { publishFacebook } from './publish/facebook.js';
import { log, warn } from './lib/log.js';

const PLATFORMS = {
  youtube: publishYouTube,
  instagram: publishInstagram,
  facebook: publishFacebook,
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return dest;
}

async function resolveVideoFile(item) {
  if (item.file) {
    const local = p(item.file);
    try {
      await fs.access(local);
      return local;
    } catch {
      /* fall through to the remote copy */
    }
  }
  if (item.videoUrl) {
    const dest = path.join(os.tmpdir(), `${item.id}.mp4`);
    log(`downloading ${item.id} from the render store`);
    return download(item.videoUrl, dest);
  }
  throw new Error('no video file and no videoUrl for this item');
}

export async function post({ only = null, force = false } = {}) {
  const config = await loadConfig();
  if (announceStart('post', config)) return { posted: 0, skipped: 'paused' };
  const platformStop = postBlockedReason(config);
  if (platformStop) {
    log(`STOPPED: ${platformStop}. Nothing was posted.`);
    return { posted: 0, skipped: 'no-platforms' };
  }

  const envDry = process.env.DRY_RUN;
  const dryRun = force
    ? false
    : envDry === 'false'
      ? false
      : envDry === 'true'
        ? true
        : config.dryRun !== false;
  const zone = tz(config);
  const day = dayKey(zone);
  const hour = hourIn(zone);

  const queue = await loadQueue();
  let list = approved(queue);
  if (only) list = list.filter((i) => i.id === only);

  const dailyCap = config.limits?.postsPerDay ?? 2;
  const alreadyToday = queue.items.filter((i) => i.status === 'posted' && i.postedOn === day).length;
  let budget = force ? Infinity : Math.max(0, dailyCap - alreadyToday);

  if (!list.length) {
    log('nothing approved — add approvals on the approval page, or let tonight\'s build queue some.');
    return { posted: 0 };
  }
  if (budget <= 0 && !force) {
    log(`daily cap reached (${alreadyToday}/${dailyCap}) — staying quiet until tomorrow.`);
    return { posted: 0, skipped: 'cap' };
  }

  await ensureDir(p('content/renders'));
  let postedCount = 0;

  for (const item of list) {
    if (budget <= 0) break;

    const brand = brandById(config, item.brand);
    if (!brand || brand.enabled === false) {
      warn(`skipping ${item.id}: brand ${item.brand} is off`);
      continue;
    }
    const capReason = checkDailyCap(config, queue.items, brand.id);
    if (capReason && !force) {
      log(`skipping ${item.id}: ${capReason}`);
      continue;
    }

    let file;
    try {
      file = await resolveVideoFile(item);
    } catch (e) {
      warn(`${item.id}: ${e.message}`);
      item.attempts = (item.attempts || 0) + 1;
      continue;
    }

    let anySuccess = false;
    for (const [name, publish] of Object.entries(PLATFORMS)) {
      if (!platformOn(brand, name)) continue;
      if (item.results?.[name]?.ok) continue;
      try {
        const result = await publish({ config, brand, item, file, dryRun });
        item.results = item.results || {};
        item.results[name] = { ...result, at: new Date().toISOString() };
        if (result.ok) anySuccess = true;
      } catch (e) {
        item.results = item.results || {};
        item.results[name] = { ok: false, error: e.message, at: new Date().toISOString() };
        warn(`${name} failed for ${item.id}: ${e.message}`);
      }
    }

    if (anySuccess || dryRun) {
      item.status = 'posted';
      item.postedOn = day;
      item.postedAt = new Date().toISOString();
      item.hour = hour;
      postedCount++;
      budget--;
      log(`posted ${item.id}`);
    } else {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts >= 3) {
        item.status = 'failed';
        warn(`${item.id} failed 3 times — parked. Fix the error, then set it back to approved.`);
      }
    }
    await saveQueue(queue);
  }

  log(`done: ${postedCount} item(s) ${dryRun ? '(dry run — nothing left this device)' : 'published'}`);
  return { posted: postedCount, dryRun };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  post({ only: arg ? arg.split('=')[1] : null }).catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}
