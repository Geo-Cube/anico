export class DatabaseTaskError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DatabaseTaskError';
  }
}

export interface DatabaseTarget {
  database: string;
  personal: boolean;
  sharedDev: boolean;
}

export function databaseTarget(
  uri: string,
  environment: Record<string, string | undefined>,
): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new DatabaseTaskError(
      'INVALID_TARGET',
      'Invalid database URI; value hidden',
    );
  }
  const database = url.pathname.slice(1);
  const suffix = database.replace(/^anico_animal_/, '');
  const authenticationDatabase = url.searchParams.get('authSource');
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const remotePersonal =
    loopback &&
    url.port === '27018' &&
    /^anico_animal_[a-z0-9_]+$/.test(database) &&
    url.username === `dev_${suffix}` &&
    !!url.password &&
    (authenticationDatabase === database ||
      authenticationDatabase === `anico_breeding_${suffix}`);
  if (
    !['mongodb:', 'mongodb+srv:'].includes(url.protocol) ||
    !/^anico_animal(?:_[a-z0-9_]+)?$/.test(database) ||
    ['root', 'admin', 'anico_root'].includes(url.username) ||
    (url.username && authenticationDatabase !== database && !remotePersonal)
  )
    throw new DatabaseTaskError(
      'INVALID_TARGET',
      'Use an explicit animal-service database and its own scoped account',
    );
  const localPersonal =
    loopback &&
    (url.port || '27017') === '27017' &&
    database === 'anico_animal_local' &&
    !url.username &&
    !url.password;
  return {
    database,
    personal:
      (remotePersonal || localPersonal) &&
      environment.NODE_ENV !== 'production' &&
      environment.APP_ENV !== 'prod',
    sharedDev:
      database === 'anico_animal' &&
      url.hostname === 'anico-dev-mongodb' &&
      url.username === 'anico_animal_dev_app' &&
      !!url.password &&
      environment.APP_ENV === 'dev',
  };
}

export function requireReset(target: DatabaseTarget, confirmation?: string) {
  if (!target.personal || confirmation !== target.database)
    throw new DatabaseTaskError(
      'RESET_FORBIDDEN',
      'Reset requires a personal database and --confirm with its exact name',
    );
}

export function requireSeed(target: DatabaseTarget, shared = false) {
  if (!target.personal && !(shared && target.sharedDev))
    throw new DatabaseTaskError(
      'SEED_FORBIDDEN',
      'Demo seed requires a personal database, or explicit --shared on the deployed dev database',
    );
}
