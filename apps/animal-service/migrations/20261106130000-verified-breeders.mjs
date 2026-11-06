/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const db = connection.db;
  if (
    !(await db.listCollections({ name: 'verifiedBreeders' }).toArray()).length
  )
    await db.createCollection('verifiedBreeders');
  await db
    .collection('verifiedBreeders')
    .createIndex(
      { breederId: 1 },
      { unique: true, name: 'verified_breeders_breeder_unique' },
    );
}
