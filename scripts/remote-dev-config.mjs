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

export function remoteArguments(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const separator = raw.indexOf('=');
    const key = separator < 0 ? raw : raw.slice(0, separator);
    const inline = separator < 0 ? undefined : raw.slice(separator + 1);
    if (
      ![
        '--check',
        '--db',
        '--confirm',
        '--retry',
        '--owner',
        '--use-running-tunnel',
      ].includes(key) ||
      values.has(key)
    )
      throw new Error('Unsupported or duplicate remote development option');
    if (['--check', '--use-running-tunnel'].includes(key)) {
      if (inline !== undefined)
        throw new Error('Boolean flags do not accept values');
      values.set(key, true);
    } else {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--'))
        throw new Error('Missing remote command option value');
      values.set(key, value);
    }
  }
  const command = values.get('--db');
  const check = values.has('--check');
  if (
    command &&
    (!['status', 'migrate', 'seed', 'reset', 'unlock'].includes(command) ||
      check)
  )
    throw new Error('Choose either --check or an allowed --db command');
  if (
    (!command && values.size > (check ? 1 : 0)) ||
    (values.has('--retry') && command !== 'migrate') ||
    (values.has('--confirm') && !['reset', 'unlock'].includes(command)) ||
    (values.has('--owner') && command !== 'unlock') ||
    (command === 'reset' &&
      (!values.has('--confirm') || values.has('--use-running-tunnel'))) ||
    (command === 'unlock' &&
      (!values.has('--confirm') || !values.has('--owner')))
  )
    throw new Error(
      'Invalid database command options; reset requires confirmation and a separate tunnel',
    );
  const extra = [];
  for (const key of ['--confirm', '--retry', '--owner'])
    if (values.has(key)) extra.push(key, values.get(key));
  return { check, command, extra, reuse: values.has('--use-running-tunnel') };
}
