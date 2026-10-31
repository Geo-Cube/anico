try {
  const fs = require('node:fs');
  const admin = db.getSiblingDB('admin');
  admin.auth({
    user: fs.readFileSync('/run/secrets/root-username', 'utf8').trim(),
    pwd: fs.readFileSync('/run/secrets/root-password', 'utf8').trim(),
  });
  const accounts = JSON.parse(
    fs.readFileSync('/run/secrets/users.json', 'utf8'),
  );
  let changes = 0;
  for (const account of accounts) {
    if (
      !/^anico_breeding(?:_[a-z0-9_]+)?$/.test(account.database) ||
      !/^[a-z][a-z0-9_]+$/.test(account.username)
    )
      throw new Error('Invalid account');
    const target = db.getSiblingDB(account.database);
    const current = target.getUser(account.username);
    if (current && current.customData?.managedBy !== 'anico-dev-database')
      throw new Error('Unmanaged user');
    if (account.active === false) {
      if (current) {
        target.dropUser(account.username);
        changes++;
      }
      continue;
    }
    const roles = [{ role: 'readWrite', db: account.database }];
    let authenticates = false;
    try {
      const probe = new Mongo(`mongodb://127.0.0.1:27017/${account.database}`);
      probe
        .getDB(account.database)
        .auth({ user: account.username, pwd: account.password });
      authenticates = probe
        .getDB(account.database)
        .runCommand({ connectionStatus: 1 })
        .authInfo.authenticatedUsers.some(
          (user) =>
            user.user === account.username && user.db === account.database,
        );
      probe.close();
    } catch {
      /* Missing/rotated accounts are reconciled below. */
    }
    if (!current) {
      target.createUser({
        user: account.username,
        pwd: account.password,
        roles,
        customData: {
          managedBy: 'anico-dev-database',
          owner: account.login ?? 'dev-application',
        },
      });
      changes++;
    } else if (
      !authenticates ||
      current.roles.length !== 1 ||
      current.roles[0].role !== 'readWrite' ||
      current.roles[0].db !== account.database
    ) {
      target.updateUser(account.username, { pwd: account.password, roles });
      changes++;
    }
  }
  print(changes ? 'ANICO_CHANGED' : 'ANICO_UNCHANGED');
} catch (error) {
  print(
    `Development DB provisioning failed (code ${Number(error.code) || 0}); credentials hidden.`,
  );
  quit(1);
}
