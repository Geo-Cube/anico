import { readFileSync } from 'node:fs';

const { domain } = JSON.parse(
  readFileSync(new URL('../environments.json', import.meta.url), 'utf8'),
);
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error(
    'CLOUDFLARE_API_TOKEN is missing. Store it in infrastructure/.env.local; do not paste it into chat.',
  );
  process.exit(1);
}

async function api(path, { optional = false } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (optional && response.status === 404) return null;
  const data = await response.json();
  if (!response.ok || !data.success) {
    // Print only error codes, never response bodies which may contain credentials.
    throw new Error(
      `Cloudflare ${path.split('?')[0]} failed (${response.status}; codes ${(data.errors ?? []).map((error) => error.code).join(',')})`,
    );
  }
  return data;
}

try {
  const verification = await api('user/tokens/verify');
  if (verification.result.status !== 'active')
    throw new Error('Cloudflare token is not active');
  const zones = await api(
    `zones?name=${encodeURIComponent(domain)}&status=active`,
  );
  if (zones.result.length !== 1)
    throw new Error('Expected one active zone for the configured domain');
  const zone = zones.result[0];
  const accountId = zone.account.id;
  const organization = await api(`accounts/${accountId}/access/organizations`, {
    optional: true,
  });
  const idps = organization
    ? await api(`accounts/${accountId}/access/identity_providers`)
    : null;
  const domains = [domain, `dev.${domain}`, `admin.${domain}`];
  const dns = [];
  for (const name of domains) {
    const records = await api(
      `zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
    );
    dns.push(
      ...records.result.map((record) => ({
        id: record.id,
        name: record.name,
        type: record.type,
        proxied: record.proxied,
      })),
    );
  }
  const applications = [];
  if (organization) {
    for (let page = 1; ; page++) {
      const apps = await api(
        `accounts/${accountId}/access/apps?per_page=100&page=${page}`,
      );
      applications.push(
        ...apps.result
          .filter((app) => domains.includes(app.domain))
          .map((app) => ({ id: app.id, domain: app.domain })),
      );
      if (page >= (apps.result_info?.total_pages ?? 1)) break;
    }
  }
  console.log(
    JSON.stringify(
      {
        domain,
        accountId,
        zoneId: zone.id,
        organization: organization
          ? {
              authDomain: organization.result.auth_domain,
              denyUnmatchedRequests:
                organization.result.deny_unmatched_requests,
              exemptedZones:
                organization.result.deny_unmatched_requests_exempted_zone_names,
            }
          : null,
        existingOtpIds: (idps?.result ?? [])
          .filter((idp) => idp.type === 'onetimepin')
          .map((idp) => idp.id),
        existingApplications: applications,
        existingDns: dns,
      },
      null,
      2,
    ),
  );
  console.log(
    'Read-only preflight complete. No DNS, Access or Tunnel changes were made. Existing resources must be reviewed/imported before apply.',
  );
  if (applications.some((app) => app.domain === domain)) {
    throw new Error(
      'An existing Access application protects production. Review it before publishing the public app.',
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
