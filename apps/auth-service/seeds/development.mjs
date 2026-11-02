/** Personal/test DB only; fixtures cannot authenticate or become the owner. */
export async function seed(connection) {
  for (const [id, role, name] of [
    ['00000000-0000-4000-8000-000000000001', 'breeder', 'Ukázkový chovatel'],
    ['00000000-0000-4000-8000-000000000002', 'admin', 'Ukázkový administrátor'],
    ['00000000-0000-4000-8000-000000000003', 'owner', 'Ukázkový vlastník'],
  ]) {
    await connection.db.collection('users').updateOne(
      { _id: id },
      {
        $setOnInsert: {
          userId: id,
          givenName: name,
          familyName: null,
          email: null,
          roles: role === 'breeder' ? ['breeder'] : ['breeder', role],
          status: 'disabled',
          fixture: true,
        },
      },
      { upsert: true },
    );
  }
}
