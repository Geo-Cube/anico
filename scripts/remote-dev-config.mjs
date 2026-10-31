import { parseEnv } from 'node:util';

export function remoteServiceName(input = 'breeding-service') {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input))
    throw new Error('Use a service name such as auth or auth-service');
  const name = input.endsWith('-service') ? input : `${input}-service`;
  if (name.length > 48) throw new Error('Service name is too long');
  return name;
}

export function remoteServiceMetadata(name, manifest, example) {
  name = remoteServiceName(name);
  if (
    manifest.name !== `@anico/${name}` ||
    typeof manifest.scripts?.dev !== 'string' ||
    !manifest.dependencies?.mongoose
  )
    throw new Error(
      'Selected workspace must be an AniCo MongoDB backend service',
    );
  const port = Number(parseEnv(example).PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Set a valid PORT in the selected service .env.example');
  return { name, workspace: manifest.name, port };
}

export function remoteDevelopmentConfig(text, settings, service) {
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
  const authenticationDatabase = uri.searchParams.get('authSource');
  const suffix = /^anico_breeding_([a-z0-9_]+)$/.exec(
    authenticationDatabase ?? '',
  )?.[1];
  const targetDatabase = service
    ? `anico_${remoteServiceName(service.name)
        .replace(/-service$/, '')
        .replaceAll('-', '_')}_${suffix}`
    : authenticationDatabase;
  if (
    uri.protocol !== 'mongodb:' ||
    uri.hostname !== '127.0.0.1' ||
    uri.port !== String(settings.localPort) ||
    !suffix ||
    ![authenticationDatabase, targetDatabase].includes(database) ||
    uri.username !== `dev_${suffix}` ||
    !uri.password
  )
    throw new Error(
      'Remote development requires a personal database through the local tunnel',
    );
  // Authentication stays in the existing personal breeding DB. Only the
  // working database changes; the server must grant its readWrite role via IaC.
  if (Buffer.byteLength(targetDatabase) > 63)
    throw new Error('Personal service database name is too long');
  uri.pathname = `/${targetDatabase}`;
  const port = service?.port ?? Number(env.PORT ?? 3000);
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
    database: targetDatabase,
    port,
    env: {
      ...env,
      MONGODB_URI: uri.href,
      PORT: String(port),
      NODE_ENV: 'development',
      APP_ENV: 'dev',
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
        '--service',
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
    (!command &&
      values.size >
        (check ? 1 : 0) +
          (values.has('--service') ? 1 : 0) +
          (values.has('--service') && values.has('--use-running-tunnel')
            ? 1
            : 0)) ||
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
  return {
    check,
    command,
    extra,
    reuse: values.has('--use-running-tunnel'),
    service: values.has('--service')
      ? remoteServiceName(values.get('--service'))
      : undefined,
  };
}
