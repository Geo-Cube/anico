import * as hcloud from '@pulumi/hcloud';
import * as pulumi from '@pulumi/pulumi';
import { foundationConfigSchema } from './config.js';
import { configureCloudflare } from './cloudflare.js';

const config = new pulumi.Config();
const settings = foundationConfigSchema.parse({
  serverId: config.requireNumber('serverId'),
  sshCidrs: config.requireObject<string[]>('sshCidrs'),
  sshPort: config.getNumber('sshPort'),
  attachFirewall: config.getBoolean('attachFirewall'),
});

// Lookup only: this program cannot create, rebuild, resize or delete the server.
const server = hcloud.getServerOutput({ id: settings.serverId });

const firewall = new hcloud.Firewall(
  'anico-foundation',
  {
    name: `anico-${pulumi.getStack()}`,
    labels: { project: 'anico', managed_by: 'pulumi' },
    rules: [
      {
        direction: 'in',
        protocol: 'tcp',
        port: String(settings.sshPort),
        sourceIps: settings.sshCidrs,
        description: 'SSH from administrators only',
      },
      {
        direction: 'in',
        protocol: 'icmp',
        sourceIps: ['0.0.0.0/0', '::/0'],
        description: 'Network diagnostics and path MTU discovery',
      },
    ],
  },
  { protect: true },
);

// Attach only after SSH CIDRs/port have been verified. HTTP will use Tunnel.
const attachment = settings.attachFirewall
  ? new hcloud.FirewallAttachment(
      'anico-foundation',
      {
        firewallId: firewall.id.apply(Number),
        serverIds: [server.id],
      },
      { protect: true },
    )
  : undefined;

export const serverId = server.id;
export const serverName = server.name;
export const serverIpv4 = server.ipv4Address;
export const firewallId = firewall.id;
export const firewallAttached = settings.attachFirewall;
export const attachmentId = attachment?.id ?? null;

const cloudflareSettings = config.getObject<{ enabled?: boolean }>(
  'cloudflare',
);
const edge = cloudflareSettings?.enabled
  ? configureCloudflare(cloudflareSettings)
  : undefined;
export const tunnelId = edge?.tunnel.id ?? null;
export const tunnelToken = edge?.token ?? null;
