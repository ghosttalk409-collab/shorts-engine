import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { p, ensureDir, dayKey } from './lib/files.js';
import { loadConfig, brandById, platformOn, tz } from './lib/config.js';
import { loadQueue, saveQueue, loadLearned, saveLearned, METRICS_CSV } from './lib/state.js';
import { youtubeStats } from './publish/youtube.js';
import { instagramStats } from './publish/instagram.js';
import { facebookStats } from './publish/facebook.js';
import { recordOutcome, scoreOf, rankedTemplates, bestHour, winners } from './lib/learn.js';
import { log, warn } from './lib/log.js';

const HEADER = 'date,id,brand,template,platform,views,likes,comments,saves,shares,score';

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

async function appendRows(rows) {
  await ensureDir(p('content'));
  let existing = '';
  try {
    existing = await fs.readFile(METRICS_CSV(), 'utf8');
  } catch {
    /* first run */
  }
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  if (!body) return;
  await fs.writeFile(METRICS_CSV(), (existing.trim() ? `${existing.trimEnd()}\n` : `${HEADER}\n`) + body + '\n');
}

/** Metrics are read-only, so this keeps running even while posting is paused. */
export async function collect() {
  const config = await loadConfig();
  const queue = await loadQueue();
  const learned = await loadLearned();
  const day = dayKey(tz(config));

  const posted = queue.items.filter((i) => i.status === 'posted' && i.results);
  if (!posted.length) {
    log('nothing posted yet — no metrics to collect.');
    return { rows: 0 };
  }

  const rows = [];
  const perItem = {};

  for (const brand of config.brands) {
    const items = posted.filter((i) => i.brand === brand.id);
    if (!items.length) continue;

    const ids = (platform) =>
      items.map((i) => i.results?.[platform]?.id).filter((id) => id && !String(id).startsWith('dry'));

    let yt = {};
    let ig = {};
    let fb = {};

    if (platformOn(brand, 'youtube') && ids('youtube').length) {
      try {
        yt = await youtubeStats(config, brand, ids('youtube'));
      } catch (e) {
        warn(`YouTube stats: ${e.message}`);
      }
    }
    if (platformOn(brand, 'instagram') && ids('instagram').length) {
      try {
        ig = await instagramStats({ brand, ids: ids('instagram') });
      } catch (e) {
        warn(`Instagram stats: ${e.message}`);
      }
    }
    if (platformOn(brand, 'facebook') && ids('facebook').length) {
      try {
        fb = await facebookStats({ brand, ids: ids('facebook') });
      } catch (e) {
        warn(`Facebook stats: ${e.message}`);
      }
    }

    for (const item of items) {
      const agg = { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
      for (const [platform, table] of [['youtube', yt], ['instagram', ig], ['facebook', fb]]) {
        const id = item.results?.[platform]?.id;
        const m = id ? table[id] : null;
        if (!m) continue;
        agg.views += m.views || 0;
        agg.likes += m.likes || 0;
        agg.comments += m.comments || 0;
        agg.saves += m.saves || 0;
        agg.shares += m.shares || 0;
        rows.push([
          day, item.id, item.brand, item.template || '', platform,
          m.views || 0, m.likes || 0, m.comments || 0, m.saves || 0, m.shares || 0,
          scoreOf(m),
        ]);
      }
      perItem[item.id] = agg;
      item.metrics = agg;
      if (agg.views > 0) recordOutcome(learned, item, agg);
    }
  }

  await appendRows(rows);
  await saveQueue(queue);
  learned.bestHour = bestHour(learned);
  await saveLearned(learned);

  const ranked = rankedTemplates(learned);
  const report = {
    generatedAt: new Date().toISOString(),
    posted: posted.length,
    totalViews: Object.values(perItem).reduce((s, m) => s + m.views, 0),
    bestHour: learned.bestHour,
    rankedTemplates: ranked,
    winners: winners(learned),
    top: queue.items
      .filter((i) => i.metrics)
      .sort((a, b) => (b.metrics.views || 0) - (a.metrics.views || 0))
      .slice(0, 5)
      .map((i) => ({ id: i.id, hook: i.hook, views: i.metrics.views || 0 })),
  };
  await fs.writeFile(p('content/report.json'), JSON.stringify(report, null, 2) + '\n');

  log(`metrics: ${rows.length} row(s). total views ${report.totalViews}`);
  if (report.bestHour !== null) log(`best posting hour so far: ${report.bestHour}:00`);
  if (report.winners.length) log(`formats to repeat: ${report.winners.join(', ')}`);
  return { rows: rows.length, report };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  collect().catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}
