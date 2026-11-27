import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, readJson, ensureDir, listFiles, isImage, isVideo, dayKey } from './lib/files.js';
import { loadConfig, announceStart, tz, brandById } from './lib/config.js';
import { loadQueue, loadLearned, addCandidates, expireOld, pending } from './lib/state.js';
import { pickHook, pickCloser, makeRng, CAPTION_FRAMES } from './lib/templates.js';
import { renderVideo } from './render.js';
import { sliceIntoLibrary } from './slice.js';
import { uploadRender, renderTag, pruneOldRenders, assetName } from './lib/github.js';
import { winners } from './lib/learn.js';
import { log, warn } from './lib/log.js';

const ASSETS_INBOX = () => p('content/assets/inbox');
const LIBRARY = () => p('content/library');
const RENDERS = () => p('content/renders');
const IDEAS = () => p('content/ideas.json');

const DEFAULT_BODY = [
  'This is the part nobody shows you.',
  'Ten seconds, no jargon.',
  'Here is the whole thing.',
];

function linesFromIdeas(ideas, brandId) {
  const shared = ideas.default || {};
  const own = ideas[brandId] || {};
  return {
    subjects: [...(own.subjects || []), ...(shared.subjects || [])],
    hooks: [...(own.hooks || []), ...(shared.hooks || [])],
    body: [...(own.body || []), ...(shared.body || [])],
  };
}

/** Newest unopened media first, then recycled library clips, as one ordered pool. */
async function assetPool(usedRel) {
  const rel = (f) => path.relative(p('.'), f);
  const inbox = (await listFiles(ASSETS_INBOX())).filter((f) => isImage(f.path) || isVideo(f.path));
  const fresh = inbox
    .filter((f) => !usedRel.has(rel(f.path)))
    .sort((a, b) => b.mtime - a.mtime)
    .map((f) => f.path);
  const recycled = (await listFiles(LIBRARY()))
    .filter((f) => isVideo(f.path))
    .map((f) => f.path);

  const seen = new Set();
  return [...fresh, ...recycled].filter((f) => {
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });
}

/** Each candidate gets a different pair, so every video in a night has visuals. */
function assetsFor(pool, index) {
  const n = pool.length;
  if (!n) return [];
  const picks = [pool[(index * 2) % n], n > 1 ? pool[(index * 2 + 1) % n] : null];
  return [...new Set(picks.filter(Boolean))];
}

export async function build({ force = false } = {}) {
  const config = await loadConfig();
  if (announceStart('build (video creator)', config)) return { created: 0, skipped: 'paused' };
  if (config.enabled === false && !force) return { created: 0, skipped: 'paused' };

  const zone = tz(config);
  const day = dayKey(zone);
  const tag = renderTag(day);
  await ensureDir(RENDERS());
  await ensureDir(ASSETS_INBOX());
  await ensureDir(LIBRARY());

  // Long uploads become reusable 6-second library clips.
  const inboxVideos = (await listFiles(ASSETS_INBOX())).filter((f) => isVideo(f.path) && f.size > 3_000_000);
  for (const v of inboxVideos) {
    await sliceIntoLibrary({ file: v.path, libDir: LIBRARY() });
  }

  const expired = await expireOld(config, 4);
  if (expired) log(`expired ${expired} stale candidate(s)`);

  const queue = await loadQueue();
  const learned = await loadLearned();
  const ideas = await readJson(IDEAS(), {});
  const used = new Set(queue.items.flatMap((i) => i.sources || []));
  const rng = makeRng(Number(day.replaceAll('-', '')));

  const count = config.limits?.candidatesPerNight ?? 3;
  const activeBrands = config.brands.filter((b) => b.enabled !== false);
  const hot = winners(learned);
  const pool = await assetPool(used);
  const seenHooks = new Set(queue.items.filter((i) => i.status === 'pending').map((i) => i.hook));
  if (!pool.length) warn('no media in content/assets/inbox or content/library — building text-only videos');

  const created = [];
  for (let i = 0; i < count; i++) {
    const brand = activeBrands[i % activeBrands.length];
    const idea = linesFromIdeas(ideas, brand.id);
    const subject = idea.subjects.length
      ? idea.subjects[Math.floor(rng() * idea.subjects.length) % idea.subjects.length]
      : brand.niche || brand.name;

    // Hand-written hooks beat templates; winners get reused on purpose.
    // No two videos in the same night open with the same line.
    let hookEntry;
    if (idea.hooks.length) {
      const start = Math.floor(rng() * idea.hooks.length) % idea.hooks.length;
      const ordered = [...idea.hooks.slice(start), ...idea.hooks.slice(0, start)];
      hookEntry = { id: 'handwritten', text: ordered.find((h) => !seenHooks.has(h)) || ordered[0] };
    } else if (hot.length && rng() > 0.35) {
      hookEntry = pickHook({ templates: Object.fromEntries(hot.map((id) => [id, { posts: 1, score: 1 }])) }, rng, subject);
      hookEntry.id = hot[0];
    } else {
      hookEntry = pickHook(learned, rng, subject);
      if (seenHooks.has(hookEntry.text)) hookEntry = pickHook(learned, rng, subject);
    }
    seenHooks.add(hookEntry.text);

    const assets = assetsFor(pool, i);
    const body = idea.body.length ? idea.body : DEFAULT_BODY;
    const id = `${brand.id}-${day.replaceAll('-', '')}-${i + 1}`;
    const outFile = path.join(RENDERS(), `${id}.mp4`);

    try {
      await renderVideo({
        spec: {
          brandName: brand.name,
          hook: hookEntry.text,
          body,
          endCard: brand.endCard,
        },
        style: { ...config.style },
        assets: assets.map((a) => ({ path: a })),
        outFile,
      });
    } catch (e) {
      warn(`render failed for ${id}: ${e.message.split('\n')[0]}`);
      continue;
    }

    let videoUrl = null;
    try {
      videoUrl = await uploadRender(outFile, tag, assetName(id));
    } catch (e) {
      warn(`could not publish video URL (${e.message}) — the local file is still usable`);
    }

    const hashtags = (brand.hashtags || []).join(' ');
    const caption = CAPTION_FRAMES[0]
      .replaceAll('{hook}', hookEntry.text)
      .replaceAll('{brand}', brand.name)
      .replaceAll('{endcard}', `${brand.endCard?.subtitle || ''} ${pickCloser(rng)}`.trim())
      .replaceAll('{hashtags}', hashtags)
      .trim();

    created.push({
      id,
      brand: brand.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      day,
      template: hookEntry.id,
      hook: hookEntry.text,
      body,
      caption,
      hashtags: brand.hashtags || [],
      file: path.relative(p('.'), outFile),
      videoUrl,
      sources: assets.map((a) => path.relative(p('.'), a)),
      results: {},
      attempts: 0,
    });
    for (const a of assets) used.add(path.relative(p('.'), a));
  }

  const added = await addCandidates(config, created);
  await pruneOldRenders(4).catch(() => {});

  log(`queued ${added.length} new candidate(s) for approval`);
  for (const a of added) log(`  • ${a.id}  "${a.hook}"`);
  if (!added.length) warn('nothing was queued — check content/assets/inbox and the render logs');
  return { created: added.length, items: added };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}
