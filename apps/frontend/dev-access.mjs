import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const DEV_API_ORIGIN = 'https://dev.anico.online';
const execute = promisify(execFile);

function parseToken(text, now) {
  const token = text.trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    throw new Error('Invalid Cloudflare session; private details hidden');
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 < now + 30000)
    throw new Error('Cloudflare session expired');
  // This decode only controls local caching. Cloudflare verifies the actual
  // signature, audience and permissions on every upstream request.
  return { token, expires: payload.exp * 1000 };
}

export function createAccessSession({
  run = execute,
  now = Date.now,
  notify = (message) => console.log(message),
} = {}) {
  let cached;
  let pending;
  async function readCached() {
    const result = await run(
      'cloudflared',
      ['access', 'token', '--app', DEV_API_ORIGIN],
      { timeout: 15000, maxBuffer: 128 * 1024, windowsHide: true },
    );
    return parseToken(result.stdout, now());
  }
  async function authenticate() {
    try {
      return await readCached();
    } catch (error) {
      if (error.code === 'ENOENT')
        throw new Error('Install cloudflared to access the shared dev API');
    }
    notify(
      'Complete GitHub sign-in for dev.anico.online in the browser. No token needs to be copied.',
    );
    try {
      // Both streams are captured. cloudflared may otherwise print a JWT or a
      // private login URL. The CLI stores its normal per-user Access session.
      await run('cloudflared', ['access', 'login', '--quiet', DEV_API_ORIGIN], {
        timeout: 180000,
        maxBuffer: 128 * 1024,
        windowsHide: true,
      });
      return await readCached();
    } catch {
      throw new Error(
        'Dev API sign-in failed or timed out. Run cloudflared access login --quiet https://dev.anico.online locally, then retry. Private output hidden.',
      );
    }
  }
  return {
    async getToken() {
      if (cached && cached.expires > now() + 60000) return cached.token;
      if (!pending)
        pending = authenticate()
          .then((value) => {
            cached = value;
            return value.token;
          })
          .finally(() => {
            pending = undefined;
          });
      return pending;
    },
  };
}
