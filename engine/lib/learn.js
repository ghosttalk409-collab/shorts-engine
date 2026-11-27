/**
 * One number per video, so the engine can prefer what works.
 *
 * score = views + 5*(likes+comments+saves) + 40*shares
 * Watch-through is folded in when the platform reports it (0..1).
 */
export function scoreOf(metrics = {}) {
  const views = Number(metrics.views || 0);
  const eng = Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.saves || 0);
  const shares = Number(metrics.shares || 0);
  const watch = Number(metrics.watchPct || 0);
  return Math.round(views * (1 + watch * 0.5) + 5 * eng + 40 * shares);
}

export function recordOutcome(learned, item, metrics) {
  const score = scoreOf(metrics);
  const t = item.template || 'unknown';
  learned.templates[t] = learned.templates[t] || { posts: 0, score: 0, best: 0 };
  learned.templates[t].posts += 1;
  learned.templates[t].score += score;
  learned.templates[t].best = Math.max(learned.templates[t].best, score);

  if (item.hour !== null && item.hour !== undefined) {
    learned.hours = learned.hours || {};
    const h = String(item.hour);
    learned.hours[h] = learned.hours[h] || { posts: 0, score: 0 };
    learned.hours[h].posts += 1;
    learned.hours[h].score += score;
  }
  return score;
}

/** The best hour to post, once there is enough data to mean anything. */
export function bestHour(learned) {
  const hours = Object.entries(learned.hours || {})
    .filter(([, v]) => v.posts >= 3)
    .map(([h, v]) => ({ hour: Number(h), avg: v.score / v.posts }));
  if (!hours.length) return null;
  return hours.sort((a, b) => b.avg - a.avg)[0].hour;
}

export function rankedTemplates(learned) {
  return Object.entries(learned.templates || {})
    .filter(([, v]) => v.posts > 0)
    .map(([id, v]) => ({ id, avg: v.score / v.posts, posts: v.posts, best: v.best }))
    .sort((a, b) => b.avg - a.avg);
}

/** Formats worth making more of: anything clearly above the channel's own average. */
export function winners(learned, minViews = 50) {
  const ranked = rankedTemplates(learned);
  if (!ranked.length) return [];
  const avg = ranked.reduce((s, r) => s + r.avg, 0) / ranked.length;
  return ranked.filter((r) => r.avg >= avg * 1.15 && r.avg > minViews).map((r) => r.id);
}
