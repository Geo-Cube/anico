import { readFileSync } from 'node:fs';
import * as pulumi from '@pulumi/pulumi';
import { unwrapMockSecrets } from './mock-secrets.js';

export async function inspectGitHubLogin(enabled: boolean, only = false) {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({ ...args, inputs: unwrapMockSecrets(args.inputs) });
        return {
          id: `${args.name}-id`,
          state: {
            ...args.inputs,
            aud: `${args.name}-aud`,
          },
        };
      },
      call(args) {
        if (args.token.includes('getZeroTrustAccessApplications'))
          return { results: [] };
        if (args.token.includes('getZeroTrustOrganization'))
          return {
            authDomain: 'anico-test.cloudflareaccess.com',
            denyUnmatchedRequests: false,
          };
        if (args.token.includes('getZeroTrustTunnelCloudflaredToken'))
          return { token: 'mock-tunnel-token' };
        throw new Error(`Unexpected lookup: ${args.token}`);
      },
    },
    'anico-foundation',
    'test',
    true,
  );
  const { configureCloudflare } = await import('../src/cloudflare.js');
  const access = JSON.parse(
    readFileSync(new URL('../access.json', import.meta.url), 'utf8'),
  );
  const members = {
    administratorEmails: ['owner@example.com'],
    developerEmails: [],
  };
  const plan = configureCloudflare(
    {
      enabled: true,
      accountId: 'a'.repeat(32),
      zoneId: 'b'.repeat(32),
      teamName: 'anico-test',
    },
    access,
    {
      enabled,
      only,
      clientId: 'Ov23liTestClient12345',
      // Deliberately plain input: implementation must still mark it secret.
      clientSecret: 'test-oauth-secret',
    },
    pulumi.secret(members),
  );
  await new Promise<void>((resolve) => {
    pulumi
      .all<unknown>([
        plan.github!.id,
        plan.dev.id,
        plan.administration.id,
        plan.tunnelConfiguration.id,
        ...plan.dns.map((record) => record.id),
      ])
      .apply(() => resolve());
  });
  return { resources, plan, access, members };
}
