import { z } from 'zod';

const restrictedCidr = z
  .union([z.cidrv4(), z.cidrv6()])
  .refine(
    (cidr) => Number(cidr.split('/')[1]) !== 0,
    'SSH must be restricted to explicit networks, not the entire Internet',
  )
  .refine(
    (cidr) =>
      !cidr.startsWith('192.0.2.') &&
      !cidr.startsWith('198.51.100.') &&
      !cidr.startsWith('203.0.113.') &&
      !cidr.toLowerCase().startsWith('2001:db8:'),
    'Replace documentation addresses with your real public IP/CIDR',
  );

export const foundationConfigSchema = z.strictObject({
  serverId: z.number().int().positive(),
  sshCidrs: z.array(restrictedCidr).min(1),
  sshPort: z.number().int().min(1).max(65535).default(22),
  attachFirewall: z.boolean().default(false),
});

export type FoundationConfig = z.infer<typeof foundationConfigSchema>;
