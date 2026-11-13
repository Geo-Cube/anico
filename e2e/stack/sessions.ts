import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

/** Název relační cookie auth-service pro `http://` origin (viz auth `router.ts`). */
export const SESSION_COOKIE = 'anico-local-session';

export type SeedRole = 'owner' | 'admin';

export interface SeededUser {
  userId: string;
  givenName: string;
  familyName: string;
  email: string;
  roles: Array<'breeder' | 'admin' | 'owner'>;
}

export interface SeededSession {
  /** Hodnota cookie `anico-local-session`. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Zapíše do DB auth-service aktivní účet ve stejném tvaru, jaký vytváří
 * registrace přes poskytovatele (`repository.register`); vlastník navíc nese
 * `ownerSlot` jako po CLI `auth:owner`. E2E ani zátěžové testy tak
 * nepotřebují Google/Microsoft ani testovací endpoint v produkčním kódu.
 */
export async function seedUser(
  client: MongoClient,
  account: Pick<SeededUser, 'givenName' | 'familyName' | 'roles'>,
): Promise<SeededUser> {
  const userId = randomUUID();
  const subject = randomUUID();
  const user: SeededUser = {
    userId,
    ...account,
    email: `${account.roles.at(-1)}-${userId.slice(0, 8)}@e2e.anico.test`,
  };
  await client
    .db()
    .collection('users')
    .insertOne({
      _id: userId as never,
      ...user,
      issuer: 'https://accounts.google.com',
      subject,
      identities: [
        {
          provider: 'google',
          issuer: 'https://accounts.google.com',
          subject,
        },
      ],
      status: 'active',
      ...(account.roles.includes('owner') ? { ownerSlot: 'primary' } : {}),
    });
  return user;
}

/** Seeduje účty `owner` (breeder+owner) a `admin` (breeder+admin). */
export async function seedUsers(
  authDatabaseUri: string,
): Promise<Record<SeedRole, SeededUser>> {
  const client = await MongoClient.connect(authDatabaseUri);
  try {
    return {
      owner: await seedUser(client, {
        givenName: 'Olga',
        familyName: 'Vlastníková',
        roles: ['breeder', 'owner'],
      }),
      admin: await seedUser(client, {
        givenName: 'Adam',
        familyName: 'Správce',
        roles: ['breeder', 'admin'],
      }),
    };
  } finally {
    await client.close();
  }
}

/**
 * Otevře novou relaci v kolekci `sessions` ve formátu auth-service
 * (`_id` = sha256 hex tokenu). Každé volání = samostatná relace, takže dva
 * prohlížečové kontexty téhož účtu se navzájem neodhlásí.
 */
export async function createSession(
  client: MongoClient,
  userId: string,
  seconds = 4 * 60 * 60,
): Promise<SeededSession> {
  const token = randomBytes(32).toString('base64url');
  const session = {
    userId,
    csrfToken: randomBytes(32).toString('base64url'),
    expiresAt: new Date(Date.now() + seconds * 1000),
    authenticatedAt: new Date(),
  };
  await client
    .db()
    .collection('sessions')
    .insertOne({
      _id: createHash('sha256').update(token).digest('hex') as never,
      ...session,
    });
  return { token, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
}
