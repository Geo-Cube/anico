import { readFileSync } from 'node:fs';
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { configureDevDeploymentAccess } from './dev-deployment-access.js';
import {
  accessConfigSchema,
  accessMembersSchema,
  type AccessMembers,
  accessPolicies,
  assertPublicProduction,
  cloudflareConfigSchema,
  githubClientIdSchema,
  ingressRoutes,
} from './access.js';

export interface GitHubLogin {
  enabled: boolean;
  only?: boolean;
  clientId: string;
  clientSecret: pulumi.Input<string>;
}

export function configureCloudflare(
  rawSettings: unknown,
  rawAccess: unknown = JSON.parse(
    readFileSync(new URL('../access.json', import.meta.url), 'utf8'),
  ),
  githubLogin?: GitHubLogin,
  privateMembers?: pulumi.Input<AccessMembers>,
  deploymentEnabled = false,
) {
  const settings = cloudflareConfigSchema.parse(rawSettings);
  const access = accessConfigSchema.parse(rawAccess);
  // Policies are secret even in tests/plain-input callers. Never print member
  // addresses in previews, state exports or shared source configuration.
  const members = pulumi
    .secret(
      privateMembers ?? {
        developerEmails: access.developerEmails,
        administratorEmails: access.administratorEmails,
      },
    )
    .apply((value) => accessMembersSchema.parse(value));
  const githubClientId = githubLogin
    ? githubClientIdSchema.parse(githubLogin.clientId)
    : undefined;
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

  // Keep the provider when login is disabled, so rollback does not delete a
  // protected resource or require changing its OAuth credentials.
  const github = githubLogin
    ? new cloudflare.ZeroTrustAccessIdentityProvider(
        'anico-github-login',
        {
          accountId,
          name: 'AniCo GitHub login',
          type: 'github',
          config: {
            clientId: githubClientId!,
            clientSecret: pulumi.secret(githubLogin.clientSecret),
          },
        },
        { protect: true },
      )
    : undefined;
  const githubEnabled = github !== undefined && githubLogin?.enabled === true;

  function privateApplication(
    name: string,
    domain: string,
    role: keyof AccessMembers,
  ) {
    return new cloudflare.ZeroTrustAccessApplication(
      name,
      {
        accountId,
        name,
        domain,
        type: 'self_hosted',
        sessionDuration: '8h',
        allowedIdps: githubEnabled
          ? githubLogin?.only
            ? [github!.id]
            : [github!.id, otp.id]
          : [otp.id],
        autoRedirectToIdentity: !githubEnabled || githubLogin?.only === true,
        appLauncherVisible: false,
        policies: members.apply((value) => accessPolicies(value[role])),
      },
      { protect: true },
    );
  }
  const dev = privateApplication(
    'anico-dev-access',
    `dev.${foundation.domain}`,
    'developerEmails',
  );
  const administration = privateApplication(
    'anico-administration-access',
    access.administratorHostname,
    'administratorEmails',
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

  const deployment = deploymentEnabled
    ? configureDevDeploymentAccess(rawSettings, tunnel.id)
    : undefined;
  const tunnelConfiguration = new cloudflare.ZeroTrustTunnelCloudflaredConfig(
    'anico-tunnel-routing',
    {
      accountId,
      tunnelId: tunnel.id,
      config: {
        ingresses: [
          ...(deployment
            ? [
                {
                  hostname: 'deploy-dev.anico.online',
                  service: 'http://coolify-proxy:80',
                  originRequest: {
                    httpHostHeader: 'deploy-dev.anico.online',
                    access: {
                      required: true,
                      teamName: settings.teamName,
                      audTags: [deployment.application.aud],
                    },
                  },
                },
              ]
            : []),
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
  return {
    tunnel,
    token,
    dns,
    dev,
    administration,
    tunnelConfiguration,
    github,
    deployment,
  };
}
