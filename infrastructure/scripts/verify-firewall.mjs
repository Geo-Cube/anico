import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'ssh-host': { type: 'string', default: 'anico-server' },
    'require-attached': { type: 'boolean', default: false },
  },
});
const cwd = fileURLToPath(new URL('../', import.meta.url));

function command(binary, args, input) {
  const result = spawnSync(binary, args, {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${binary} failed; check credentials, SSH or local state`);
  return result.stdout;
}

async function api(path) {
  assert.ok(process.env.HCLOUD_TOKEN, 'HCLOUD_TOKEN is missing');
  const response = await fetch(`https://api.hetzner.cloud/v1/${path}`, {
    headers: { Authorization: `Bearer ${process.env.HCLOUD_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hetzner API HTTP ${response.status}`);
  return response.json();
}

try {
  const config = JSON.parse(
    command('pulumi', ['config', '--stack', 'shared', '--json']),
  );
  const get = (key) => config[`anico-foundation:${key}`]?.value;
  const serverId = Number(get('serverId'));
  const port = Number(get('sshPort') ?? 22);
  const cidrs = JSON.parse(get('sshCidrs'));
  const firewallId = Number(
    command('pulumi', ['stack', 'output', 'firewallId', '--stack', 'shared']),
  );
  assert.ok(Number.isSafeInteger(serverId) && serverId > 0);
  assert.ok(Number.isSafeInteger(firewallId) && firewallId > 0);
  const [{ server }, { firewall }] = await Promise.all([
    api(`servers/${serverId}`),
    api(`firewalls/${firewallId}`),
  ]);
  assert.equal(server.status, 'running', 'Server must be running');
  assert.equal(firewall.labels.project, 'anico');
  assert.equal(firewall.labels.managed_by, 'pulumi');
  assert.equal(firewall.rules.length, 2, 'Expected only SSH and ICMP rules');
  const ssh = firewall.rules.find((rule) => rule.protocol === 'tcp');
  const icmp = firewall.rules.find((rule) => rule.protocol === 'icmp');
  assert.equal(ssh?.direction, 'in');
  assert.equal(ssh?.port, String(port));
  assert.deepEqual([...ssh.source_ips].sort(), [...cidrs].sort());
  assert.equal(icmp?.direction, 'in');
  assert.deepEqual([...icmp.source_ips].sort(), ['0.0.0.0/0', '::/0']);
  const attached = server.public_net.firewalls;
  assert.ok(
    attached.every((entry) => entry.id === firewallId),
    'Unexpected additional firewall: its rules could allow extra traffic',
  );
  assert.ok(
    firewall.applied_to.every(
      (entry) => entry.type === 'server' && entry.server.id === serverId,
    ),
    'Firewall is shared with other servers or selectors; review before changing it',
  );
  if (values['require-attached']) {
    assert.equal(get('attachFirewall'), 'true');
    assert.deepEqual(attached, [{ id: firewallId, status: 'applied' }]);
    assert.equal(firewall.applied_to.length, 1);
  }

  // A separate connection proves access for NEW sessions, not a cached SSH master.
  const probe = `import ipaddress, json, os, subprocess
connection = os.environ['SSH_CONNECTION'].split()
cidrs = json.loads(${JSON.stringify(JSON.stringify(cidrs))})
assert any(ipaddress.ip_address(connection[0]) in ipaddress.ip_network(cidr) for cidr in cidrs), 'SSH source is outside allowed CIDRs'
assert int(connection[3]) == ${port}, 'SSH port mismatch'
assert connection[2] == ${JSON.stringify(server.public_net.ipv4.ip)}, 'SSH target differs from Hetzner server'
listeners = subprocess.check_output(['ss', '-H', '-lnt'], text=True).splitlines()
public = [line.split()[3] for line in listeners if not line.split()[3].startswith(('127.', '[::1]:'))]
assert all(endpoint.rsplit(':', 1)[1] == '${port}' for endpoint in public), 'Unexpected public TCP listener'
health = subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Health.Status}}', 'anico-tunnel-cloudflared-1'], text=True).strip()
assert health == 'healthy', 'Cloudflare Tunnel is not healthy'
print(json.dumps({'source': connection[0], 'target': connection[2], 'port': int(connection[3]), 'publicTcpListeners': public, 'tunnel': health}))
`;
  const host = values['ssh-host'];
  assert.match(host, /^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/, 'Invalid SSH host');
  const result = JSON.parse(
    command(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'UpdateHostKeys=no',
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-o',
        'ConnectTimeout=10',
        host,
        'python3 -',
      ],
      probe,
    ),
  );
  console.log(
    JSON.stringify({ serverId, firewallId, attached, ...result }, null, 2),
  );
  console.log(
    'Verified firewall rules, fresh SSH connection, private TCP ports and healthy Tunnel. No changes made.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
