import { z } from 'zod';

export const devDatabaseSettingsSchema = z.strictObject({
  hostname: z.literal('db-dev.anico.online'),
  project: z.literal('anico-dev-database'),
  containerName: z.literal('anico-dev-mongodb'),
  volume: z.literal('anico-dev-mongodb'),
  dataNetwork: z.literal('anico-dev-data'),
  egressNetwork: z.literal('anico-dev-app'),
  rootDirectory: z.literal('/srv/anico/dev/database'),
  image: z.string().regex(/^mongo:8\.0@sha256:[a-f0-9]{64}$/),
  localPort: z.number().int().min(1024).max(65535),
  wiredTigerCacheGB: z.number().min(0.25).max(1),
  perThreadAllocator: z.boolean(),
});
export const databaseMemberSchema = z.strictObject({
  login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  email: z.email().trim().toLowerCase(),
});
export const databaseMembersSchema = z
  .array(databaseMemberSchema)
  .min(1)
  .superRefine((members, context) => {
    if (
      new Set(members.map((member) => member.login.toLowerCase())).size !==
      members.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate database login' });
    if (new Set(members.map((member) => member.email)).size !== members.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate database identity',
      });
  });
const password = z.string().regex(/^[a-f0-9]{64}$/);
const account = z.strictObject({
  username: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  database: z.string().regex(/^anico_breeding(?:_[a-z0-9_]+)?$/),
  password,
});
export const databaseCredentialsSchema = z
  .strictObject({
    version: z.literal(1),
    root: z.strictObject({ username: z.literal('anico_root'), password }),
    app: account,
    developers: z.array(
      account.extend({
        login: databaseMemberSchema.shape.login,
        email: databaseMemberSchema.shape.email,
        active: z.boolean(),
      }),
    ),
  })
  .superRefine((credentials, context) => {
    const accounts = [credentials.app, ...credentials.developers];
    if (
      new Set(accounts.map((a) => a.database)).size !== accounts.length ||
      new Set(accounts.map((a) => a.username)).size !== accounts.length ||
      new Set([credentials.root.password, ...accounts.map((a) => a.password)])
        .size !==
        accounts.length + 1
    )
      context.addIssue({
        code: 'custom',
        message: 'Database accounts must be independent',
      });
    for (const member of credentials.developers) {
      const suffix = member.login.toLowerCase().replaceAll('-', '_');
      if (
        member.username !== `dev_${suffix}` ||
        member.database !== `anico_breeding_${suffix}`
      )
        context.addIssue({
          code: 'custom',
          message: 'Workspace does not match its owner',
        });
    }
    if (
      credentials.app.database !== 'anico_breeding' ||
      credentials.app.username !== 'anico_dev_app'
    )
      context.addIssue({
        code: 'custom',
        message: 'Unexpected dev application account',
      });
  });
export type DatabaseCredentials = z.infer<typeof databaseCredentialsSchema>;

export function reconcileDatabaseCredentials(
  rawMembers: unknown,
  rawExisting: unknown,
  generatePassword: () => string,
): DatabaseCredentials {
  const members = databaseMembersSchema.parse(rawMembers);
  const existing =
    rawExisting === undefined
      ? undefined
      : databaseCredentialsSchema.parse(rawExisting);
  const developers = (existing?.developers ?? []).map((member) => ({
    ...member,
    active: false,
  }));
  for (const member of members) {
    const previous = developers.find(
      (value) => value.login.toLowerCase() === member.login.toLowerCase(),
    );
    if (previous) {
      previous.email = member.email;
      previous.active = true;
    } else {
      const suffix = member.login.toLowerCase().replaceAll('-', '_');
      developers.push({
        ...member,
        username: `dev_${suffix}`,
        database: `anico_breeding_${suffix}`,
        password: generatePassword(),
        active: true,
      });
    }
  }
  return databaseCredentialsSchema.parse({
    version: 1,
    root: existing?.root ?? {
      username: 'anico_root',
      password: generatePassword(),
    },
    app: existing?.app ?? {
      username: 'anico_dev_app',
      database: 'anico_breeding',
      password: generatePassword(),
    },
    developers,
  });
}
