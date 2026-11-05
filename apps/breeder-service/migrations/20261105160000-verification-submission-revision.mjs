const REQUEST = '$verificationRequest';
const HISTORY = { $ifNull: [`${REQUEST}.reviewHistory`, []] };

/** Počet rozhodnutí RETURNED v poli `reviews`. */
const returnedCount = (reviews) => ({
  $size: {
    $filter: {
      input: reviews,
      as: 'review',
      cond: { $eq: ['$$review.decision', 'RETURNED'] },
    },
  },
});

/**
 * Revize podání (UC-01, optimistická kontrola rozhodnutí): žádostem doplní
 * `revision` a položkám `reviewHistory` revizi, o které se rozhodovalo.
 *
 * Revize roste o 1 při každé opravě RETURNED -> PENDING a vrácená žádost jde
 * dál jen opravou, takže:
 * - položka historie na indexu i rozhodla o revizi 1 + počet RETURNED před ní;
 * - každé RETURNED v historii už bylo opraveno, kromě posledního, pokud žádost
 *   stále je RETURNED: revize = 1 + počet RETURNED, ve stavu RETURNED jen počet
 *   RETURNED (nejméně 1).
 * Existující hodnoty se nepřepisují, takže migrace je idempotentní; nepoužívá
 * aplikační modely.
 * @param {import('mongoose').Connection} connection
 */
export async function up(connection) {
  const breeders = connection.db.collection('breeders');

  await breeders.updateMany(
    {
      verificationRequest: { $type: 'object' },
      $or: [
        { 'verificationRequest.revision': { $exists: false } },
        {
          'verificationRequest.reviewHistory': {
            $elemMatch: { revision: { $exists: false } },
          },
        },
      ],
    },
    [
      {
        $set: {
          'verificationRequest.reviewHistory': {
            $map: {
              input: { $range: [0, { $size: HISTORY }] },
              as: 'index',
              in: {
                // uložená revize (pozdější argument) má přednost
                $mergeObjects: [
                  {
                    revision: {
                      $add: [
                        1,
                        returnedCount({ $slice: [HISTORY, '$$index'] }),
                      ],
                    },
                  },
                  { $arrayElemAt: [HISTORY, '$$index'] },
                ],
              },
            },
          },
        },
      },
      {
        $set: {
          'verificationRequest.revision': {
            $ifNull: [
              `${REQUEST}.revision`,
              {
                $max: [
                  1,
                  {
                    $add: [
                      returnedCount(HISTORY),
                      {
                        $cond: [
                          { $eq: [`${REQUEST}.status`, 'RETURNED'] },
                          0,
                          1,
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  );
}
