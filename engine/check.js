import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, ROOT } from './lib/files.js';
import { loadConfig, platformOn, blockedReason } from './lib/config.js';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

const results = [];
const ok = (name, detail = '') => results.push({ name, pass: true, detail });
const bad = (name, detail = '') => results.push({ name, pass: false, detail });

async function binary(name, args) {
  try {
    const { stdout } = await run(name, args);
    return stdout.split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function check() {
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? ok('node', process.versions.node) : bad('node', `need >= 20, found ${process.versions.node}`);

  const ff = await binary(FFMPEG, ['-version']);
  ff ? ok('ffmpeg', ff.slice(0, 60)) : bad('ffmpeg', 'ffmpeg is not installed on PATH');

  const fp = await binary(FFPROBE, ['-version']);
  fp ? ok('ffprobe', fp.slice(0, 60)) : bad('ffprobe', 'ffprobe is not installed on PATH');

  let hasDrawtext = false;
  try {
    const { stdout } = await run(FFMPEG, ['-hide_banner', '-filters']);
    hasDrawtext = /drawtext/.test(stdout);
  } catch {
    /* ignore */
  }
  hasDrawtext ? ok('ffmpeg drawtext') : bad('ffmpeg drawtext', 'this ffmpeg build cannot draw text — install a full build');

  for (const font of ['Display.ttf', 'Text-Bold.ttf']) {
    const file = path.join(ROOT, 'assets', 'fonts', font);
    const exists = await fs.access(file).then(() => true, () => false);
    exists ? ok(`font ${font}`) : bad(`font ${font}`, 'missing from assets/fonts');
  }

  let config;
  try {
    config = await loadConfig();
    ok('config.json');
  } catch (e) {
    bad('config.json', e.message);
    print();
    return results;
  }

  const blocked = blockedReason(config);
  blocked ? bad('kill switch', `paused: ${blocked}`) : ok('kill switch', 'engine is allowed to run');
  ok('dryRun', String(config.dryRun !== false));

  const ids = config.brands.map((b) => b.id);
  new Set(ids).size === ids.length ? ok('brand ids unique') : bad('brand ids unique', ids.join(', '));

  for (const brand of config.brands.filter((b) => b.enabled !== false)) {
    for (const [platform, fn] of Object.entries({
      youtube: () => ['clientId', 'clientSecret', 'refreshToken'],
      instagram: () => ['igUserId', 'token'],
      facebook: () => ['pageId', 'token'],
    })) {
      if (!platformOn(brand, platform)) continue;
      for (const key of fn()) {
        const envName = brand.env?.[platform]?.[key];
        if (!envName) bad(`${brand.id}/${platform}/${key}`, 'no env var name configured');
        else if (!process.env[envName]) bad(`${brand.id}/${platform}/${key}`, `secret ${envName} is not set`);
        else ok(`${brand.id}/${platform}/${key}`, envName);
      }
    }
  }

  if (process.env.GITHUB_REPOSITORY) ok('repo', process.env.GITHUB_REPOSITORY);
  else bad('repo', 'GITHUB_REPOSITORY is not set (only needed inside GitHub Actions)');

  if (process.env.GITHUB_TOKEN) ok('github token');
  else bad('github token', 'GITHUB_TOKEN not set — videos will have no public URL to post from');

  print();
  return results;
}

function print() {
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  }
  const failures = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  check().catch((e) => {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  });
}
