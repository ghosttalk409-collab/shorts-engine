import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, isVideo, listFiles } from './lib/files.js';
import { ffprobeDuration } from './render.js';
import { log } from './lib/log.js';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const hashOf = async (file) => {
  const st = await fs.stat(file);
  return crypto.createHash('sha1').update(`${path.basename(file)}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 8);
};

/**
 * Cuts a long clip into a few short segments so the same footage can be
 * recycled into new shorts on days when nothing new was uploaded.
 */
export async function sliceIntoLibrary({ file, libDir, segments = 3, seconds = 6, maxLibrary = 40 }) {
  if (!isVideo(file)) return [];
  await ensureDir(libDir);
  const duration = await ffprobeDuration(file);
  if (!duration || duration < seconds + 1) return [];

  const tag = await hashOf(file);
  const made = [];

  for (let i = 0; i < segments; i++) {
    const span = Math.max(seconds + 1, (duration - seconds - 1) / Math.max(1, segments));
    const start = Math.min(duration - seconds - 0.5, 1 + i * span);
    if (!Number.isFinite(start) || start < 0) continue;
    const out = path.join(libDir, `${tag}-${i}.mp4`);
    try {
      await fs.access(out);
      made.push(out);
      continue;
    } catch {
      /* render it */
    }
    await run(FFMPEG, [
      '-y', '-v', 'error',
      '-ss', start.toFixed(2),
      '-t', String(seconds),
      '-i', file,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
      '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p',
      out,
    ]).catch((e) => log(`slice skipped for ${path.basename(file)}: ${e.message.split('\n')[0]}`));
    try {
      await fs.access(out);
      made.push(out);
    } catch {
      /* nothing usable */
    }
  }

  const all = await listFiles(libDir);
  if (all.length > maxLibrary) {
    for (const stale of all.slice(0, all.length - maxLibrary)) {
      await fs.unlink(stale.path).catch(() => {});
    }
  }

  if (made.length) log(`library: +${made.length} segment(s) from ${path.basename(file)}`);
  return made;
}
