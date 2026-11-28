import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isImage, isVideo, ensureDir, ROOT } from './lib/files.js';
import { log } from './lib/log.js';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

/** Fonts shipped with the repo win, so a render looks the same on any machine. */
const REPO_FONTS = path.join(ROOT, 'assets', 'fonts');
const SYSTEM_FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
];

const ENCODE = [
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-g', '60',
  '-an',
  '-movflags', '+faststart',
];

async function ffmpeg(args) {
  try {
    return await run(FFMPEG, args, { maxBuffer: 1024 * 1024 * 16 });
  } catch (e) {
    const detail = String(e.stderr || e.message || '').split('\n').slice(-12).join('\n');
    throw new Error(`ffmpeg failed:\n${detail}`);
  }
}

export async function ffprobeDuration(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file,
  ]);
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

async function firstExisting(list) {
  for (const f of list.filter(Boolean)) {
    try {
      await fs.access(f);
      return f;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Big condensed display face for hooks, a normal bold for captions. */
async function resolveFonts(style = {}) {
  const display = await firstExisting([
    style.fontFile,
    process.env.DISPLAY_FONT,
    path.join(REPO_FONTS, 'Display.ttf'),
    ...SYSTEM_FONTS,
  ]);
  const text = await firstExisting([
    style.textFontFile,
    process.env.TEXT_FONT,
    path.join(REPO_FONTS, 'Text-Bold.ttf'),
    ...SYSTEM_FONTS,
  ]);
  return { display, text: text || display };
}

function wrap(text, maxChars) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const cleanText = (s) => String(s ?? '').replace(/[\\%]/g, '').replace(/[\r\n]+/g, '\n').trim();

async function textFile(dir, name, text) {
  const file = path.join(dir, `${name}.txt`);
  await fs.writeFile(file, cleanText(text));
  return file;
}

/**
 * Line advance, in pixels, for one line of text. Some ffmpeg builds draw a box glyph
 * where a line break sits inside a textfile, so every line is drawn on its own and
 * stacked here. The ratios come from the two fonts the engine downloads.
 */
const FONT_LINE_HEIGHT = { display: 1.5, text: 1.146 };
const linePitch = (kind, size, spacing = 0) =>
  Math.round(size * (FONT_LINE_HEIGHT[kind] || 1.3)) + spacing;

async function textLines({ dir, name, font, size, color, x, y, pitch, lines }) {
  const list = (Array.isArray(lines) ? lines : String(lines ?? '').split('\n')).filter((l) => l.trim());
  const filters = [];
  for (let i = 0; i < list.length; i++) {
    const file = await textFile(dir, `${name}-${i}`, list[i]);
    filters.push(drawtext({ file, font, size, color, x, y: y + Math.round(i * pitch) }));
  }
  return filters;
}

function drawtext({ file, font, size, color, x, y, lineSpacing = 14 }) {
  const fontPart = font ? `fontfile='${font}'` : 'font=Sans';
  return [
    `drawtext=${fontPart}`,
    `textfile='${file}'`,
    'expansion=none',
    `fontcolor=${color}`,
    `fontsize=${size}`,
    `line_spacing=${lineSpacing}`,
    `x=${x}`,
    `y=${y}`,
  ].join(':');
}

const vfChain = (parts) => parts.filter(Boolean).join(',');

async function cardScene({ out, dir, seconds, style, font, fontKind = 'display', lines, label }) {
  const W = style.w;
  const H = style.h;
  const name = `card-${path.basename(out, '.mp4')}`;
  const labelFile = label ? await textFile(dir, `label-${path.basename(out, '.mp4')}`, label) : null;

  const filters = [
    `drawbox=x=0:y=${Math.round(H * 0.3)}:w=10:h=${Math.round(H * 0.4)}:color=${style.accent}:t=fill`,
    labelFile
      ? drawtext({ file: labelFile, font, size: 34, color: style.muted, x: 90, y: Math.round(H * 0.16) })
      : null,
    ...(await textLines({
      dir,
      name,
      font,
      size: 66,
      color: style.textColor,
      x: 90,
      y: Math.round(H * 0.34),
      pitch: linePitch(fontKind, 66, fontKind === 'display' ? 2 : 14),
      lines,
    })),
    `fade=t=in:st=0:d=0.25`,
    `fade=t=out:st=${Math.max(0, seconds - 0.25).toFixed(2)}:d=0.25`,
  ];

  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${style.bg}:s=${W}x${H}:r=30:d=${seconds}`,
    '-vf', vfChain(filters),
    '-t', String(seconds),
    ...ENCODE,
    out,
  ]);
}

async function visualScene({ out, dir, file, seconds, style, font, caption, startAt = 0 }) {
  const W = style.w;
  const H = style.h;
  const capName = `cap-${path.basename(out, '.mp4')}`;

  const input = isImage(file)
    ? ['-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', file]
    : ['-ss', String(startAt), '-t', String(seconds), '-i', file];

  const base = isImage(file)
    ? style.kenBurns
      ? vfChain([
          `scale=${Math.round(W * 1.35)}:${Math.round(H * 1.35)}:force_original_aspect_ratio=increase`,
          `crop=${Math.round(W * 1.35)}:${Math.round(H * 1.35)}`,
          `zoompan=z='min(zoom+0.0010,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(seconds * 30)}:s=${W}x${H}:fps=30`,
          'setsar=1',
        ])
      : vfChain([`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, 'setsar=1'])
    : vfChain([
        `scale=${W}:${H}:force_original_aspect_ratio=increase`,
        `crop=${W}:${H}`,
        'setsar=1',
        'fps=30',
      ]);

  const filters = [
    base,
    `drawbox=x=0:y=${Math.round(H * 0.56)}:w=${W}:h=${Math.round(H * 0.22)}:color=black@0.55:t=fill`,
    ...(caption
      ? await textLines({
          dir,
          name: capName,
          font,
          size: 48,
          color: style.textColor,
          x: 70,
          y: Math.round(H * 0.59),
          pitch: linePitch('text', 48, 4),
          lines: caption,
        })
      : []),
    `fade=t=in:st=0:d=0.25`,
    `fade=t=out:st=${Math.max(0, seconds - 0.25).toFixed(2)}:d=0.25`,
  ];

  await ffmpeg([
    '-y',
    ...input,
    '-vf', vfChain(filters),
    '-frames:v', String(Math.round(seconds * 30)),
    ...ENCODE,
    out,
  ]);
}

/**
 * Builds one vertical short.
 *
 * spec: { brand, hook, body: string[], endCard: {title, subtitle} }
 * assets: [{ path }]  (images or videos; up to 2 are used)
 */
export async function renderVideo({ spec, style, assets = [], outFile, workDir }) {
  const S = {
    w: 1080,
    h: 1920,
    bg: '0x0B0F14',
    accent: '0x3DDC97',
    textColor: 'white',
    muted: '0xB8C2CC',
    hookSeconds: 2.8,
    clipSeconds: 5,
    endSeconds: 2.6,
    kenBurns: true,
    ...style,
  };

  const tmp = workDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'short-')));
  await ensureDir(tmp);
  await ensureDir(path.dirname(outFile));

  const fonts = await resolveFonts(S);
  const scenes = [];

  const hookText = wrap(String(spec.hook).toUpperCase(), 17);
  const hookScene = path.join(tmp, 's1-hook.mp4');
  await cardScene({
    out: hookScene,
    dir: tmp,
    seconds: S.hookSeconds,
    style: S,
    font: fonts.display,
    fontKind: 'display',
    lines: hookText,
    label: spec.brandName ? spec.brandName.toUpperCase() : null,
  });
  scenes.push(hookScene);

  const usable = assets.filter((a) => a && a.path && (isImage(a.path) || isVideo(a.path))).slice(0, 2);
  const bodyLines = (spec.body || []).length ? spec.body : [''];

  if (usable.length) {
    for (let i = 0; i < usable.length; i++) {
      const scene = path.join(tmp, `s2-${i}.mp4`);
      await visualScene({
        out: scene,
        dir: tmp,
        file: usable[i].path,
        seconds: S.clipSeconds,
        style: S,
        font: fonts.text,
        caption: wrap(bodyLines[i % bodyLines.length] || spec.hook, 30).join('\n'),
        startAt: usable[i].startAt || 0,
      });
      scenes.push(scene);
    }
  } else {
    const scene = path.join(tmp, 's2-text.mp4');
    await cardScene({
      out: scene,
      dir: tmp,
      seconds: Math.max(4, S.clipSeconds),
      style: S,
      font: fonts.text,
      lines: wrap(bodyLines[0] || spec.hook, 22),
      fontKind: 'text',
      label: null,
    });
    scenes.push(scene);
  }

  const endScene = path.join(tmp, 's3-end.mp4');
  // Title on its own line, subtitle wrapped underneath.
  const endLines = [spec.endCard?.title || spec.brandName || '', ...wrap(spec.endCard?.subtitle || '', 24)];
  await cardScene({
    out: endScene,
    dir: tmp,
    seconds: S.endSeconds,
    style: S,
    font: fonts.text,
    fontKind: 'text',
    lines: endLines,
    label: null,
  });
  scenes.push(endScene);

  const listFile = path.join(tmp, 'scenes.txt');
  await fs.writeFile(listFile, scenes.map((s) => `file '${s.replaceAll("'", "'\\''")}'`).join('\n') + '\n');

  const silent = path.join(tmp, 'video-only.mp4');
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silent]);

  const duration = await ffprobeDuration(silent);
  const music = S.music && (await fs.access(S.music).then(() => true, () => false)) ? S.music : null;

  if (music) {
    await ffmpeg([
      '-y',
      '-i', silent,
      '-stream_loop', '-1',
      '-i', music,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-t', String(duration.toFixed(2)),
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      outFile,
    ]);
  } else {
    await ffmpeg([
      '-y',
      '-i', silent,
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-t', String(duration.toFixed(2)),
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outFile,
    ]);
  }

  const finalDuration = await ffprobeDuration(outFile);
  log(`rendered ${path.relative(process.cwd(), outFile)} (${finalDuration.toFixed(1)}s)`);
  return { outFile, duration: finalDuration, scenes: scenes.length };
}
