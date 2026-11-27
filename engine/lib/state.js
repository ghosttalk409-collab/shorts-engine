import { p, readJson, writeJson, dayKey } from './files.js';

export const QUEUE = () => p('content/queue.json');
export const LEARNED = () => p('content/learned.json');
export const METRICS_CSV = () => p('content/metrics.csv');

export const emptyQueue = () => ({ version: 1, items: [] });

export async function loadQueue() {
  const q = await readJson(QUEUE(), emptyQueue());
  if (!q.items) q.items = [];
  return q;
}

export async function saveQueue(queue) {
  await writeJson(QUEUE(), queue);
}

/** Newest first. */
export const sorted = (queue) =>
  [...queue.items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

export async function addCandidates(config, items) {
  const queue = await loadQueue();
  const known = new Set(queue.items.map((i) => i.id));
  const added = items.filter((i) => !known.has(i.id));
  queue.items.push(...added);
  await saveQueue(queue);
  return added;
}

export async function updateItem(id, patch) {
  const queue = await loadQueue();
  const item = queue.items.find((i) => i.id === id);
  if (!item) throw new Error(`No queue item ${id}`);
  Object.assign(item, patch);
  await saveQueue(queue);
  return item;
}

export const pending = (queue) => queue.items.filter((i) => i.status === 'pending');

export const approved = (queue) =>
  queue.items
    .filter((i) => i.status === 'approved')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

export const postedOnDay = (queue, tz, day = dayKey(tz)) =>
  queue.items.filter((i) => i.status === 'posted' && i.postedOn === day);

/** Retires stale candidates so the approval page never fills up with old junk. */
export async function expireOld(config, keepDays = 4) {
  const queue = await loadQueue();
  const cutoff = Date.now() - keepDays * 86400000;
  let changed = 0;
  for (const item of queue.items) {
    if (item.status !== 'pending') continue;
    if (new Date(item.createdAt).getTime() < cutoff) {
      item.status = 'expired';
      changed++;
    }
  }
  if (changed) await saveQueue(queue);
  return changed;
}

export async function loadLearned() {
  return readJson(LEARNED(), { templates: {}, captions: {}, bestHour: null, updatedAt: null });
}

export async function saveLearned(learned) {
  learned.updatedAt = new Date().toISOString();
  await writeJson(LEARNED(), learned);
}
