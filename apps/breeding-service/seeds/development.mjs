import { Types } from 'mongoose';

/** Insert missing demo plans; preserve edits to existing fixtures. */
export async function seed(connection) {
  const plans = connection.db.collection('breedingplans');
  const fixtures = [
    {
      _id: new Types.ObjectId('a11c00000000000000000001'),
      name: 'Ukázkový odchov A',
    },
    {
      _id: new Types.ObjectId('a11c00000000000000000002'),
      name: 'Ukázkový odchov B',
    },
  ];
  for (const fixture of fixtures) {
    await plans.updateOne(
      { _id: fixture._id, _anicoSeed: 'breeding-demo-v1' },
      {
        $setOnInsert: {
          ...fixture,
          _anicoSeed: 'breeding-demo-v1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
