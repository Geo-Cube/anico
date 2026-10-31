import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { accessPolicies, cloudflareConfigSchema } from './access.js';
import { devDatabaseSettingsSchema } from './dev-database.js';

export function configureDevDatabaseAccess(
  rawCloud: unknown,
  rawDatabase: unknown,
  githubId: pulumi.Input<string>,
  emails: pulumi.Input<string[]>,
) {
  const cloud = cloudflareConfigSchema.parse(rawCloud);
  const database = devDatabaseSettingsSchema.parse(rawDatabase);
  const application = new cloudflare.ZeroTrustAccessApplication(
    'anico-dev-database-access',
    {
      accountId: cloud.accountId,
      name: 'AniCo developer databases',
      domain: database.hostname,
      type: 'self_hosted',
      sessionDuration: '8h',
      allowedIdps: [githubId],
      autoRedirectToIdentity: true,
      appLauncherVisible: false,
      policies: pulumi.secret(emails).apply(accessPolicies),
    },
    { protect: true },
  );
  const tunnel = new cloudflare.ZeroTrustTunnelCloudflared(
    'anico-dev-database-tunnel',
    {
      accountId: cloud.accountId,
      name: `anico-dev-database-${pulumi.getStack()}`,
      configSrc: 'cloudflare',
    },
    { protect: true },
  );
  const routing = new cloudflare.ZeroTrustTunnelCloudflaredConfig(
    'anico-dev-database-routing',
    {
      accountId: cloud.accountId,
      tunnelId: tunnel.id,
      config: {
        ingresses: [
          {
            hostname: database.hostname,
            service: `tcp://${database.containerName}:27017`,
            originRequest: {
              access: {
                required: true,
                teamName: cloud.teamName,
                audTags: [application.aud],
              },
            },
          },
          { service: 'http_status:404' },
        ],
      },
    },
    { protect: true },
  );
  const dns = new cloudflare.DnsRecord(
    'anico-dns-dev-database',
    {
      zoneId: cloud.zoneId,
      name: database.hostname,
      type: 'CNAME',
      content: pulumi.interpolate`${tunnel.id}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: 'Managed by AniCo Pulumi',
    },
    { protect: true, dependsOn: [application, routing] },
  );
  const token = pulumi.secret(
    cloudflare.getZeroTrustTunnelCloudflaredTokenOutput({
      accountId: cloud.accountId,
      tunnelId: tunnel.id,
    }).token,
  );
  return { application, tunnel, routing, dns, token };
}
