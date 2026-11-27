import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/files.js';

/**
 * Keeps binary font files out of the repo and still guarantees the same look.
 * Runs before a build; if the download fails, render.js falls back to a system font.
 */
const FONTS = [
  {
    file: 'Display.ttf',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf'],
  },
  {
    file: 'Text-Bold.ttf',
    urls: ['https://raw.githubusercontent.com/google/fonts/main/ufl/ubuntu/Ubuntu-Bold.ttf'],
  },
];

const dir = path.join(ROOT, 'assets', 'fonts');
await fs.mkdir(dir, { recursive: true });

for (const font of FONTS) {
  const out = path.join(dir, font.file);
  const have = await fs.access(out).then(() => true, () => false);
  if (have) {
    console.log(`font ok: ${font.file}`);
    continue;
  }

  let done = false;
  for (const url of font.urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) throw new Error('file too small to be a font');
      await fs.writeFile(out, buf);
      console.log(`font downloaded: ${font.file} (${(buf.length / 1024).toFixed(0)} KB)`);
      done = true;
      break;
    } catch (e) {
      console.log(`font ${font.file} from ${url} failed: ${e.message}`);
    }
  }
  if (!done) console.log(`font ${font.file} unavailable — a system font will be used instead`);
}
