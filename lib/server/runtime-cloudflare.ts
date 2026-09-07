import { env } from 'cloudflare:workers';

export function provideRuntime() {
  return env;
}
