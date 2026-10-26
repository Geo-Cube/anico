import { readFileSync } from 'node:fs';
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import {
  accessConfigSchema,
  accessPolicies,
  assertPublicProduction,
  cloudflareConfigSchema,
  ingressRoutes,
} from './access.js';

export function configureCloudflare(
  rawSettings: unknown,
  rawAccess: unknown = JSON.parse(
    readFileSync(new URL('../access.json', import.meta.url), 'utf8'),
  ),
) {
  const settings = cloudflareConfigSchema.parse(rawSettings);
  const access = accessConfigSchema.parse(rawAccess);
  const foundation = JSON.parse(
    readFileSync(new URL('../environments.json', import.meta.url), 'utf8'),
  ) as { domain: string };
  const routes = ingressRoutes(foundation.domain, access);

  // Organization-wide Access settings must never turn the public app private.
  const organization = settings.createOrganization
    ? new cloudflare.ZeroTrustOrganization(
        'anico-organization',
        {
          accountId: settings.accountId,
          name: 'AniCo',
          authDomain: `${settings.teamName}.cloudflareaccess.com`,
          denyUnmatchedRequests: false,
        },
        { protect: true },
      )
    : undefined;
  const organizationAccountId = organization
    ? pulumi.output(settings.accountId)
    : cloudflare
        .getZeroTrustOrganizationOutput({ accountId: settings.accountId })
        .apply((current) => {
          assertPublicProduction(foundation.domain, current);
          if (
            current.authDomain !== `${settings.teamName}.cloudflareaccess.com`
          ) {
            throw new Error(
              'Configured teamName does not match the existing Zero Trust organization',
            );
          }
          return settings.accountId;
        });

  const accountId = organization
    ? organizationAccountId
    : cloudflare
        .getZeroTrustAccessApplicationsOutput({
          accountId: organizationAccountId,
          domain: foundation.domain,
          exact: true,
        })
        .apply((current) => {
          if (current.results.length > 0) {
            throw new Error(
              'An existing Access application protects production. Review it before publishing the public app.',
            );
          }
          return settings.accountId;
        });

  const otp = new cloudflare.ZeroTrustAccessIdentityProvider(
    'anico-email-login',
    {
      accountId,
      name: 'AniCo email login',
      type: 'onetimepin',
      config: {},
    },
    {
      protect: true,
      ...(organization ? { dependsOn: [organization] } : {}),
      ...(settings.existingOtpId
        ? { import: `${settings.accountId}/${settings.existingOtpId}` }
        : {}),
    },
  );

  function privateApplication(name: string, domain: string, emails: string[]) {
    return new cloudflare.ZeroTrustAccessApplication(
      name,
      {
        accountId,
        name,
        domain,
        type: 'self_hosted',
        sessionDuration: '8h',
        allowedIdps: [otp.id],
        autoRedirectToIdentity: true,
        appLauncherVisible: false,
        policies: accessPolicies(emails),
      },
      { protect: true },
    );
  }
  const dev = privateApplication(
    'anico-dev-access',
    `dev.${foundation.domain}`,
    access.developerEmails,
  );
  const administration = privateApplication(
    'anico-administration-access',
    access.administratorHostname,
    access.administratorEmails,
  );
  // Intentionally no Access application for foundation.domain (production).

  const tunnel = new cloudflare.ZeroTrustTunnelCloudflared(
    'anico-tunnel',
    {
      accountId,
      name: `anico-${pulumi.getStack()}`,
      configSrc: 'cloudflare',
    },
    { protect: true, ...(organization ? { dependsOn: [organization] } : {}) },
  );

  const tunnelConfiguration = new cloudflare.ZeroTrustTunnelCloudflaredConfig(
    'anico-tunnel-routing',
    {
      accountId,
      tunnelId: tunnel.id,
      config: {
        ingresses: [
          ...routes.map((route) => ({
            hostname: route.hostname,
            service: route.service,
            ...(route.audience
              ? {
                  originRequest: {
                    httpHostHeader: route.hostname,
                    access: {
                      required: true,
                      teamName: settings.teamName,
                      audTags: [
                        route.audience === 'dev' ? dev.aud : administration.aud,
                      ],
                    },
                  },
                }
              : { originRequest: { httpHostHeader: route.hostname } }),
          })),
          { service: 'http_status:404' },
        ],
      },
    },
    { protect: true },
  );

  const dns = routes.flatMap((route) =>
    access.publish[route.audience ?? 'production']
      ? [
          new cloudflare.DnsRecord(
            `anico-dns-${route.audience ?? 'production'}`,
            {
              zoneId: settings.zoneId,
              name: route.hostname,
              type: 'CNAME',
              content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
              proxied: true,
              ttl: 1,
              comment: 'Managed by AniCo Pulumi',
            },
            {
              protect: true,
              dependsOn: [dev, administration, tunnelConfiguration],
            },
          ),
        ]
      : [],
  );

  const token = pulumi.secret(
    cloudflare.getZeroTrustTunnelCloudflaredTokenOutput({
      accountId,
      tunnelId: tunnel.id,
    }).token,
  );
  return { tunnel, token, dns, dev, administration, tunnelConfiguration };
}
