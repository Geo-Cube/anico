import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { cloudflareConfigSchema } from './access.js';

export function configureDevDeploymentAccess(
  raw: unknown,
  tunnelId: pulumi.Input<string>,
) {
  const version = new pulumi.Config().getNumber('devDeployTokenVersion') ?? 0;
  const settings = cloudflareConfigSchema.parse(raw);
  const token = new cloudflare.ZeroTrustAccessServiceToken(
    'anico-dev-deploy-token',
    {
      accountId: settings.accountId,
      name: 'AniCo dev deployment CI',
      duration: '8760h',
      ...(version > 0
        ? {
            clientSecretVersion: version,
            previousClientSecretExpiresAt: new pulumi.Config().require(
              'devDeployPreviousSecretExpiresAt',
            ),
          }
        : {}),
    },
    { protect: true, additionalSecretOutputs: ['clientId', 'clientSecret'] },
  );
  const application = new cloudflare.ZeroTrustAccessApplication(
    'anico-dev-deploy-access',
    {
      accountId: settings.accountId,
      name: 'AniCo development deployment API',
      domain: 'deploy-dev.anico.online',
      type: 'self_hosted',
      appLauncherVisible: false,
      policies: [
        {
          name: 'Development CI only',
          decision: 'non_identity',
          precedence: 1,
          includes: [{ serviceToken: { tokenId: token.id } }],
        },
      ],
    },
    { protect: true },
  );
  const dns = new cloudflare.DnsRecord(
    'anico-dns-dev-deploy',
    {
      zoneId: settings.zoneId,
      name: 'deploy-dev.anico.online',
      type: 'CNAME',
      content: pulumi.interpolate`${tunnelId}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
      comment: 'Managed by AniCo Pulumi',
    },
    { protect: true, dependsOn: [application] },
  );
  return { token, application, dns };
}
