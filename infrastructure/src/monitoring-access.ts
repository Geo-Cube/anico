import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { accessPolicies, cloudflareConfigSchema } from './access.js';
import { monitoringSettingsSchema } from './monitoring.js';

export function configureMonitoringAccess(
  rawCloud: unknown,
  rawMonitoring: unknown,
  githubId: pulumi.Input<string>,
  emails: pulumi.Input<string[]>,
) {
  const cloud = cloudflareConfigSchema.parse(rawCloud);
  const monitoring = monitoringSettingsSchema.parse(rawMonitoring);
  const application = new cloudflare.ZeroTrustAccessApplication(
    'anico-monitoring-access',
    {
      accountId: cloud.accountId,
      name: 'AniCo monitoring',
      domain: monitoring.hostname,
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
    'anico-monitoring-tunnel',
    {
      accountId: cloud.accountId,
      name: `anico-monitoring-${pulumi.getStack()}`,
      configSrc: 'cloudflare',
    },
    { protect: true },
  );
  const routing = new cloudflare.ZeroTrustTunnelCloudflaredConfig(
    'anico-monitoring-routing',
    {
      accountId: cloud.accountId,
      tunnelId: tunnel.id,
      config: {
        ingresses: [
          {
            hostname: monitoring.hostname,
            service: `http://${monitoring.containerName}:8000`,
            originRequest: {
              httpHostHeader: monitoring.hostname,
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
    'anico-dns-monitoring',
    {
      zoneId: cloud.zoneId,
      name: monitoring.hostname,
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
