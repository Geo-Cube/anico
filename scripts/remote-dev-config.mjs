import { parseEnv } from 'node:util';

export function remoteDevelopmentConfig(text, settings) {
  const env = parseEnv(text);
  if (
    !Number.isInteger(settings.localPort) ||
    settings.localPort < 1024 ||
    settings.localPort > 65535
  )
    throw new Error('Invalid local database tunnel port');
  if (settings.hostname !== 'db-dev.anico.online')
    throw new Error('Unexpected development database endpoint');
  let uri;
  try {
    uri = new URL(env.MONGODB_URI);
  } catch {
    throw new Error('Invalid private development configuration');
  }
  const database = uri.pathname.slice(1);
  const suffix = database.replace(/^anico_breeding_/, '');
  if (
    uri.protocol !== 'mongodb:' ||
    uri.hostname !== '127.0.0.1' ||
    uri.port !== String(settings.localPort) ||
    !/^anico_breeding_[a-z0-9_]+$/.test(database) ||
    uri.username !== `dev_${suffix}` ||
    !uri.password ||
    uri.searchParams.get('authSource') !== database
  )
    throw new Error(
      'Remote development requires a personal database through the local tunnel',
    );
  const port = Number(env.PORT ?? 3000);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [settings.localPort, 5173].includes(port)
  )
    throw new Error('Choose a separate unprivileged backend port');
  if (
    !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(
      env.LOG_LEVEL ?? 'debug',
    )
  )
    throw new Error('Invalid development log level');
  return {
    database,
    port,
    env: {
      ...env,
      PORT: String(port),
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      LOG_LEVEL: env.LOG_LEVEL ?? 'debug',
    },
  };
}

export function redactRemoteLog(line) {
  return line
    .replace(
      /https:\/\/[A-Za-z0-9.-]+\/cdn-cgi\/access\/cli\?[^\s]+/g,
      '[Cloudflare login opened in browser; private parameters hidden]',
    )
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '[MongoDB URI hidden]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[Access token hidden]',
    );
}
