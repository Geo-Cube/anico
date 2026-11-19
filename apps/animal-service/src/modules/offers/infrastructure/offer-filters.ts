/**
 * Jediné místo, kde se pravidlo „blokující nabídka“ (SCHEDULED nebo ACTIVE k `now`) překládá
 * do Mongo: nestažená a bez konce platnosti nebo s koncem v budoucnosti. Používá ho zápis
 * nabídky, stažení i budoucí tržiště; odpovídá `canWithdraw(offerStatus(...))` v doméně.
 */
export function blockingOfferMatch(now: Date) {
  return {
    withdrawnAt: null,
    $or: [{ validTo: null }, { validTo: { $gt: now } }],
  };
}
