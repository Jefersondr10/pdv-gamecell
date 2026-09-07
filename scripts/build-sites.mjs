import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A VPS build also has dist/server/index.js, but exports a Node handler rather
// than the Sites Worker. Always explicitly build the correct deployment target.
const cli = fileURLToPath(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
);
const result = spawnSync(process.execPath, [cli, 'build'], {
  stdio: 'inherit',
  env: { ...process.env, DEPLOY_TARGET: 'sites' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const worker = readFileSync(
  new URL('../dist/server/index.js', import.meta.url),
  'utf8',
);
if (
  !worker.includes('MIGRATION_TARGET_ORIGIN') ||
  !/\bfetch\s*\(/.test(worker)
) {
  throw new Error(
    'Expected the Sites proxy Worker. Do not package the VPS output.',
  );
}
console.log('Sites Worker target verified. Ready for package-site.sh.');
