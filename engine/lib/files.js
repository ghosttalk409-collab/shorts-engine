import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export const p = (...parts) => path.join(ROOT, ...parts);

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${e.message}`);
  }
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dir) {
  try {
    const names = await fs.readdir(dir);
    const out = [];
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const full = path.join(dir, n);
      const st = await fs.stat(full);
      if (st.isFile()) out.push({ name: n, path: full, size: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => a.mtime - b.mtime);
  } catch {
    return [];
  }
}

/** YYYY-MM-DD in the configured timezone (default Asia/Kolkata). */
export function dayKey(tz = 'Asia/Kolkata', date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(date);
}

export function hourIn(tz = 'Asia/Kolkata', date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date),
  );
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'clip';

export const MEDIA_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.m4v', '.webm'];

export const isImage = (f) => /\.(jpe?g|png|webp)$/i.test(f);
export const isVideo = (f) => /\.(mp4|mov|m4v|webm)$/i.test(f);
