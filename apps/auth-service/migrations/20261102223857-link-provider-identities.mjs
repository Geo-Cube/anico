/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const users = connection.db.collection('users');
  // Preserve existing userIds, roles, profiles, sessions and registration data.
  for await (const user of users.find({
    issuer: { $type: 'string' },
    subject: { $type: 'string' },
    identities: { $exists: false },
  })) {
    if (!['google', 'microsoft', 'apple'].includes(user.provider))
      throw new Error('Cannot migrate an unknown identity provider');
    await users.updateOne(
      { _id: user._id, identities: { $exists: false } },
      {
        $set: {
          identities: [
            {
              provider: user.provider,
              issuer: user.issuer,
              subject: user.subject,
            },
          ],
        },
      },
    );
  }
  // One verified issuer/subject pair can belong to only one AniCo user.
  await users.createIndex(
    { 'identities.issuer': 1, 'identities.subject': 1 },
    {
      name: 'unique_external_identity',
      unique: true,
      partialFilterExpression: {
        'identities.issuer': { $type: 'string' },
        'identities.subject': { $type: 'string' },
      },
    },
  );
}
