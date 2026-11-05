/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const plans = connection.db.collection('breedingplans');
  await plans.updateMany(
    { createdAt: { $exists: false }, _id: { $type: 'objectId' } },
    [{ $set: { createdAt: { $toDate: '$_id' } } }],
  );
  await plans.updateMany({ updatedAt: { $exists: false } }, [
    { $set: { updatedAt: { $ifNull: ['$createdAt', '$$NOW'] } } },
  ]);
}
