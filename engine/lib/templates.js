/**
 * Hook and caption banks.
 *
 * These are deliberately brand-neutral: the engine is not tied to Ghost Talk.
 * A brand supplies its own `niche` and `endCard`, and content/ideas.json can
 * override any of this with hand-written lines.
 */

export const HOOKS = [
  { id: 'plain-question', weight: 1, text: 'Did you know {subject}?' },
  { id: 'nobody-told-you', weight: 1, text: 'Nobody tells you this about {subject}.' },
  { id: 'stop-doing', weight: 1, text: 'Stop doing this with {subject}.' },
  { id: 'three-seconds', weight: 1, text: 'Three seconds to check {subject}.' },
  { id: 'what-happens', weight: 1, text: 'Here is what happens to {subject}.' },
  { id: 'myth', weight: 1, text: 'The thing everyone believes about {subject} is wrong.' },
  { id: 'who-sees', weight: 1, text: 'Who can actually see {subject}?' },
  { id: 'count', weight: 1, text: 'How many people can read {subject}?' },
  { id: 'proof', weight: 1, text: 'Watch what happens when I try to read {subject}.' },
  { id: 'cost', weight: 1, text: 'This is what {subject} costs you.' },
];

export const CLOSERS = [
  'Link in bio.',
  'Try it once and tell me what you think.',
  'Comment "how" and I will send it.',
  'Save this before you forget.',
  'Follow for one privacy check a day.',
];

export const CAPTION_FRAMES = [
  '{hook} {brand} — {endcard}',
  '{hook}\n\n{endcard}\n\n{hashtags}',
  '{hook}\n\n{endcard}',
];

/** Deterministic tiny RNG so a rerun produces the same plan (nice for debugging). */
export function makeRng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Epsilon-greedy pick over the hook bank, biased by what has actually performed.
 * learned.templates[id] = { posts, score }.
 */
export function pickHook(learned, rng, subject) {
  const eps = 0.2;
  const scored = HOOKS.map((h) => {
    const past = learned?.templates?.[h.id];
    const avg = past && past.posts > 0 ? past.score / past.posts : null;
    return { ...h, avg };
  });

  let pool = scored.filter((h) => h.avg !== null).sort((a, b) => b.avg - a.avg);
  if (!pool.length || rng() < eps) pool = scored.filter((h) => h.avg === null);
  if (!pool.length) pool = scored;

  const chosen = pool[Math.floor(rng() * pool.length) % pool.length];
  return { ...chosen, text: chosen.text.replaceAll('{subject}', subject) };
}

export function pickCloser(rng) {
  return CLOSERS[Math.floor(rng() * CLOSERS.length) % CLOSERS.length];
}
