const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = (...a) => console.log(`[${stamp()}]`, ...a);
export const warn = (...a) => console.warn(`[${stamp()}] WARN`, ...a);

export function fail(msg) {
  console.error(`[${stamp()}] FAIL`, msg);
  process.exitCode = 1;
}
