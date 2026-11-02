/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const db = connection.db;
  for (const name of ['users', 'sessions', 'login_attempts']) {
    if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name);
  }
  await db.collection('users').createIndex({ userId: 1 }, { unique: true });
  await db.collection('users').createIndex({ issuer: 1, subject: 1 }, {
    unique: true, partialFilterExpression: { issuer: { $type: 'string' }, subject: { $type: 'string' } },
  });
  await db.collection('users').createIndex({ownerSlot:1},{unique:true,partialFilterExpression:{ownerSlot:{$type:'string'}}});
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ userId: 1 });
  await db.collection('login_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
