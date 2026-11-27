import { p, readJson, dayKey } from './files.js';
import { log, warn } from './log.js';

export async function loadConfig() {
  return readJson(p('config.json'), null).then((c) => {
    if (!c) throw new Error('config.json is missing from the repo root.');
    return c;
  });
}

/** Global kill switch. Returns null when we may run, or a reason string when we may not. */
export function blockedReason(config) {
  if (!config) return 'config.json missing';
  if (config.enabled === false) return 'config.enabled is false (master pause is on)';
  const brands = (config.brands || []).filter((b) => b.enabled !== false);
  if (!brands.length) return 'every brand is disabled';
  return null;
}

/** Posting additionally needs at least one platform switched on. */
export function postBlockedReason(config) {
  const base = blockedReason(config);
  if (base) return base;
  const anyPlatform = config.brands
    .filter((b) => b.enabled !== false)
    .some((b) => Object.values(b.platforms || {}).some((pl) => pl && pl.enabled));
  if (!anyPlatform) return 'no brand has any platform switched on';
  return null;
}

export function brandById(config, id) {
  return (config.brands || []).find((b) => b.id === id) || null;
}

/** Reads a secret using the env var name declared in config, so accounts stay swappable. */
export function secret(config, brand, platform, key) {
  const name = brand?.env?.[platform]?.[key] || '';
  const value = name ? process.env[name] : '';
  if (!value) {
    throw new Error(
      `Missing secret. Set repository secret "${name || `${platform}.${key}`}" for brand "${brand?.id}".`,
    );
  }
  return value;
}

export function optionalSecret(config, brand, platform, key) {
  const name = brand?.env?.[platform]?.[key] || '';
  return name ? process.env[name] || '' : '';
}

export function platformOn(brand, platform) {
  return Boolean(brand?.platforms?.[platform]?.enabled);
}

export function tz(config) {
  return config?.timezone || 'Asia/Kolkata';
}

export function today(config) {
  return dayKey(tz(config));
}

/** Refuses to run past the daily cap so a retry loop can never spam. */
export function checkDailyCap(config, queue, brandId) {
  const day = today(config);
  const cap = config.limits?.maxPostsPerBrandPerDay ?? 2;
  const postedToday = queue.filter(
    (q) => q.brand === brandId && q.status === 'posted' && q.postedOn === day,
  ).length;
  if (postedToday >= cap) return `${brandId} already posted ${postedToday}/${cap} today`;
  return null;
}

export function announceStart(script, config) {
  log(`--- ${script} ---`);
  const blocked = blockedReason(config);
  if (blocked) {
    log(`STOPPED: ${blocked}. Nothing was posted or changed.`);
    return true;
  }
  log(`brands: ${config.brands.filter((b) => b.enabled !== false).map((b) => b.id).join(', ')}`);
  if (config.dryRun) warn('dryRun is true — every publish call will be simulated.');
  return false;
}
