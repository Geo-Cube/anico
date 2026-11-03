/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const db = connection.db;
  if (!(await db.listCollections({ name: 'animals' }).toArray()).length)
    await db.createCollection('animals');
  await db
    .collection('animals')
    .createIndex({ ownerUserId: 1, _id: -1 }, { name: 'animals_owner_cursor' });
  await db
    .collection('animals')
    .createIndex(
      { ownerUserId: 1, species: 1, breedId: 1, _id: -1 },
      { name: 'animals_owner_species_breed' },
    );
}
