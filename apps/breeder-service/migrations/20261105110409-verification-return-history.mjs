const QUEUE_INDEX = {
  'verificationRequest.status': 1,
  'verificationRequest.lastSubmittedAt': 1,
};
const REPLACED_QUEUE_INDEX =
  'verificationRequest.status_1_verificationRequest.submittedAt_1';

/**
 * Vrácení žádosti k doplnění (UC-01): existujícím žádostem doplní
 * lastSubmittedAt, returnReason a reviewHistory a frontu indexuje podle
 * posledního podání. Idempotentní; nepoužívá aplikační modely.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  const breeders = connection.db.collection('breeders');
  const withRequest = { verificationRequest: { $type: 'object' } };

  await breeders.updateMany(
    {
      ...withRequest,
      'verificationRequest.lastSubmittedAt': { $exists: false },
    },
    [
      {
        $set: {
          'verificationRequest.lastSubmittedAt':
            '$verificationRequest.submittedAt',
        },
      },
    ],
  );

  await breeders.updateMany(
    { ...withRequest, 'verificationRequest.returnReason': { $exists: false } },
    { $set: { 'verificationRequest.returnReason': null } },
  );

  // PENDING ještě nemá rozhodnutí; rozhodnutá žádost dostane své jediné
  await breeders.updateMany(
    { ...withRequest, 'verificationRequest.reviewHistory': { $exists: false } },
    [
      {
        $set: {
          'verificationRequest.reviewHistory': {
            $cond: {
              if: {
                $and: [
                  {
                    $in: [
                      '$verificationRequest.status',
                      ['APPROVED', 'REJECTED'],
                    ],
                  },
                  {
                    $eq: [
                      { $type: '$verificationRequest.reviewedBy' },
                      'string',
                    ],
                  },
                  {
                    $eq: [{ $type: '$verificationRequest.reviewedAt' }, 'date'],
                  },
                ],
              },
              then: [
                {
                  decision: '$verificationRequest.status',
                  reviewedBy: '$verificationRequest.reviewedBy',
                  reviewedAt: '$verificationRequest.reviewedAt',
                  reason: {
                    $cond: {
                      if: { $eq: ['$verificationRequest.status', 'REJECTED'] },
                      then: {
                        $ifNull: ['$verificationRequest.rejectionReason', null],
                      },
                      else: null,
                    },
                  },
                },
              ],
              else: { $literal: [] },
            },
          },
        },
      },
    ],
  );

  // výchozí název shodný se schématem Mongoose: model.init() při startu nic nemění
  await breeders.createIndex(QUEUE_INDEX);
  if (await breeders.indexExists(REPLACED_QUEUE_INDEX)) {
    await breeders.dropIndex(REPLACED_QUEUE_INDEX);
  }
}
