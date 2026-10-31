try {
  const fs = require('node:fs');
  const accounts = JSON.parse(
    fs.readFileSync('/run/secrets/users.json', 'utf8'),
  );
  let verified = 0;
  for (const account of accounts.filter((value) => value.active !== false)) {
    const connection = new Mongo(
      `mongodb://127.0.0.1:27017/${account.database}`,
    );
    const authentication = connection.getDB(account.database);
    authentication.auth({ user: account.username, pwd: account.password });
    try {
      for (const database of account.databases) {
        const own = connection.getDB(database);
        const collection = own.getCollection(
          `_anico_permission_probe_${new ObjectId().toString()}`,
        );
        try {
          collection.insertOne({ test: true });
          if (!collection.findOne({ test: true }))
            throw new Error('Own service database unavailable');
        } finally {
          collection.drop();
        }
      }
      const allDatabases = accounts.flatMap((value) => value.databases);
      for (const forbidden of new Set([
        'admin',
        'anico_prod',
        'anico_auth',
        ...allDatabases.filter((name) => !account.databases.includes(name)),
      ])) {
        let denied = false;
        try {
          connection
            .getDB(forbidden)
            .getCollection('_anico_permission_probe')
            .findOne({});
        } catch (error) {
          if (Number(error.code) === 13) denied = true;
          else throw error;
        }
        if (!denied) throw new Error('Cross-database access was not denied');
      }
    } finally {
      connection.close();
    }
    verified++;
  }
  print(
    `Verified ${verified} scoped accounts: own service DBs writable, other developers/shared databases denied.`,
  );
} catch (error) {
  print(
    `Development DB access verification failed (code ${Number(error.code) || 0}); credentials hidden.`,
  );
  quit(1);
}
