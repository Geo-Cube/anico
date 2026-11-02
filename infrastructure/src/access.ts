import { z } from 'zod';

const emails = z
  .array(z.email().trim().toLowerCase())
  .transform((values) => [...new Set(values)]);

export const githubClientIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9]{16,100}$/,
    'Use the OAuth Client ID from GitHub, not the application name or GitHub login',
  );

export const accessConfigSchema = z.strictObject({
  administratorHostname: z.string().min(1),
  developerEmails: emails,
  administratorEmails: emails,
  publish: z.strictObject({
    production: z.boolean(),
    dev: z.boolean(),
    administration: z.boolean(),
  }),
});

export const cloudflareConfigSchema = z.strictObject({
  enabled: z.literal(true),
  accountId: z.string().regex(/^[a-f\d]{32}$/i),
  zoneId: z.string().regex(/^[a-f\d]{32}$/i),
  teamName: z.string().regex(/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/),
  createOrganization: z.boolean().default(false),
  existingOtpId: z.uuid().optional(),
});

export type AccessConfig = z.infer<typeof accessConfigSchema>;
export type CloudflareConfig = z.infer<typeof cloudflareConfigSchema>;
export const accessMembersSchema = accessConfigSchema.pick({
  developerEmails: true,
  administratorEmails: true,
});
export type AccessMembers = z.infer<typeof accessMembersSchema>;

export function accessPolicies(allowedEmails: string[]) {
  // With users, Access implicitly denies everyone else. A Deny Everyone rule
  // alongside Allow would override it, so we only use it for an empty list.
  if (allowedEmails.length === 0) {
    return [
      {
        name: 'Closed until users are configured',
        decision: 'deny',
        precedence: 1,
        includes: [{ everyone: {} }],
      },
    ];
  }
  return [
    {
      name: 'Approved team members',
      decision: 'allow',
      precedence: 1,
      includes: allowedEmails.map((email) => ({ email: { email } })),
    },
  ];
}

export function ingressRoutes(domain: string, access: AccessConfig) {
  if (access.administratorHostname !== `admin.${domain}`) {
    throw new Error('Administration must use its own admin subdomain');
  }
  return [
    {
      hostname: access.administratorHostname,
      service: access.publish.administration
        ? 'http://coolify-proxy:80'
        : 'http_status:503',
      audience: 'administration' as const,
    },
    {
      hostname: `dev.${domain}`,
      service: access.publish.dev
        ? 'http://coolify-proxy:80'
        : 'http_status:503',
      audience: 'dev' as const,
    },
    {
      hostname: domain,
      service: access.publish.production
        ? 'http://coolify-proxy:80'
        : 'http_status:503',
      audience: null,
    },
  ];
}

export function assertPublicProduction(
  domain: string,
  organization: {
    denyUnmatchedRequests?: boolean | undefined;
    denyUnmatchedRequestsExemptedZoneNames?: string[] | undefined;
  },
) {
  if (
    organization.denyUnmatchedRequests &&
    !organization.denyUnmatchedRequestsExemptedZoneNames?.includes(domain)
  ) {
    throw new Error(
      'Account-wide Cloudflare Access would block public production. Review the organization exemptions before continuing.',
    );
  }
}
