import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const command = fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url));
const result = spawnSync(process.execPath, [command, 'build', '--precompress'], { stdio: 'inherit', env: { ...process.env, DEPLOY_TARGET: 'vps' } });
process.exit(result.status ?? 1);
