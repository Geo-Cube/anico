/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  for (const name of [
    'development_requests',
    'development_codes',
    'development_sessions',
  ]) {
    if (!(await connection.db.listCollections({ name }).toArray()).length)
      await connection.db.createCollection(name);
    await connection.db
      .collection(name)
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  await connection.db
    .collection('development_sessions')
    .createIndex({ userId: 1 });
}
