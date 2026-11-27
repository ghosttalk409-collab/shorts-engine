import fs from 'node:fs/promises';
import { p } from './lib/files.js';
import { loadConfig, blockedReason } from './lib/config.js';

const config = await loadConfig().catch(() => null);
const reason = blockedReason(config);
const dryRun = config?.dryRun !== false;

console.log(reason ? `PAUSED: ${reason}` : `RUNNING (dryRun=${dryRun})`);
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `run=${reason ? 'false' : 'true'}\ndryRun=${dryRun}\n`);
}
