import * as pulumi from '@pulumi/pulumi';

export async function inspectPlan(attachFirewall: boolean) {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  const lookups: pulumi.runtime.MockCallArgs[] = [];
  process.env.PULUMI_CONFIG = JSON.stringify({
    'anico-foundation:serverId': '171254722',
    'anico-foundation:sshCidrs': '["8.8.8.8/32"]',
    'anico-foundation:attachFirewall': String(attachFirewall),
  });
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.type.endsWith(':Firewall') ? '42' : '43',
          state: args.inputs,
        };
      },
      call(args) {
        lookups.push(args);
        if (args.token !== 'hcloud:index/getServer:getServer') {
          throw new Error(`Unexpected cloud lookup: ${args.token}`);
        }
        return {
          id: args.inputs.id,
          name: 'existing-anico',
          ipv4Address: '192.0.2.20',
        };
      },
    },
    'anico-foundation',
    'test',
    true,
  );
  const program = await import('../src/index.js');
  await new Promise<void>((resolve) => {
    pulumi
      .all([program.serverId, program.firewallId, program.attachmentId])
      .apply(() => resolve());
  });
  return { resources, lookups, program };
}
