import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import type { CreateOfferInput } from '@anico/shared-schemas';
import { offerUseCases } from '../../src/modules/offers/application/offers.js';
import {
  OFFER_START_TOLERANCE_MS,
  OfferError,
  canWithdraw,
  offerStatus,
  planValidity,
  type OfferRecord,
} from '../../src/modules/offers/domain/offer.js';
import type {
  AnimalOffers,
  OfferAnimal,
  OfferRepository,
} from '../../src/modules/offers/domain/ports.js';
import { AnimalError } from '../../src/modules/animal/domain/entity.js';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const HOUR = 3_600_000;

const owner = testIdentity({ roles: ['breeder'] });
const stranger = testIdentity({ roles: ['breeder'] });
const ANIMAL_ID = '000000000000000000000001';
const animal: OfferAnimal = {
  id: ANIMAL_ID,
  name: 'Luna',
  species: 'dog',
  breedId: 'aljassky-malamut',
};

function record(overrides: Partial<OfferRecord> = {}): OfferRecord {
  return {
    id: 'f00000000000000000000001',
    animalId: ANIMAL_ID,
    ownerUserId: owner.userId,
    regionId: 'praha',
    validFrom: at(-HOUR),
    validTo: null,
    message: null,
    createdAt: at(-HOUR),
    createdBy: owner.userId,
    withdrawnAt: null,
    withdrawnBy: null,
    ...overrides,
  };
}

describe('UC04-STS-1..3 offerStatus', () => {
  it('derives all four statuses from times and withdrawal', () => {
    expect(
      offerStatus(
        { validFrom: at(HOUR), validTo: null, withdrawnAt: null },
        NOW,
      ),
    ).toBe('SCHEDULED');
    expect(
      offerStatus(
        { validFrom: at(-HOUR), validTo: at(HOUR), withdrawnAt: null },
        NOW,
      ),
    ).toBe('ACTIVE');
    expect(
      offerStatus(
        { validFrom: at(-HOUR), validTo: null, withdrawnAt: null },
        NOW,
      ),
    ).toBe('ACTIVE');
    expect(
      offerStatus(
        { validFrom: at(-HOUR), validTo: at(-1), withdrawnAt: null },
        NOW,
      ),
    ).toBe('EXPIRED');
    expect(
      offerStatus(
        { validFrom: at(-HOUR), validTo: null, withdrawnAt: at(-1) },
        NOW,
      ),
    ).toBe('WITHDRAWN');
  });

  it('treats the boundaries: validFrom == now is ACTIVE, validFrom = now + 1 ms is SCHEDULED', () => {
    const noEnd = { validTo: null, withdrawnAt: null };
    expect(offerStatus({ ...noEnd, validFrom: at(0) }, NOW)).toBe('ACTIVE');
    expect(offerStatus({ ...noEnd, validFrom: at(1) }, NOW)).toBe('SCHEDULED');
    expect(offerStatus({ ...noEnd, validFrom: at(-1) }, NOW)).toBe('ACTIVE');
  });

  it('treats the boundaries: validTo == now is EXPIRED, validTo = now + 1 ms is ACTIVE', () => {
    const base = { validFrom: at(-HOUR), withdrawnAt: null };
    expect(offerStatus({ ...base, validTo: at(0) }, NOW)).toBe('EXPIRED');
    expect(offerStatus({ ...base, validTo: at(1) }, NOW)).toBe('ACTIVE');
    expect(offerStatus({ ...base, validTo: at(-1) }, NOW)).toBe('EXPIRED');
  });

  it('lets withdrawal win over expiry and over a future start', () => {
    expect(
      offerStatus(
        {
          validFrom: at(-2 * HOUR),
          validTo: at(-HOUR),
          withdrawnAt: at(-HOUR * 1.5),
        },
        NOW,
      ),
    ).toBe('WITHDRAWN');
    expect(
      offerStatus(
        { validFrom: at(HOUR), validTo: null, withdrawnAt: at(-1) },
        NOW,
      ),
    ).toBe('WITHDRAWN');
  });

  it('lets an elapsed end win over a validFrom in the future (EXPIRED before SCHEDULED)', () => {
    expect(
      offerStatus(
        { validFrom: at(HOUR), validTo: at(-1), withdrawnAt: null },
        NOW,
      ),
    ).toBe('EXPIRED');
  });
});

describe('UC04-STS-4 canWithdraw', () => {
  it.each([
    ['SCHEDULED', true],
    ['ACTIVE', true],
    ['WITHDRAWN', false],
    ['EXPIRED', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(canWithdraw(status)).toBe(expected);
  });
});

describe('UC04-TIM-1..3 planValidity', () => {
  const errorOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error as OfferError;
    }
    throw new Error('expected planValidity to throw');
  };

  it('uses now when validFrom is missing and keeps validTo null', () => {
    expect(planValidity({}, NOW)).toEqual({ validFrom: NOW, validTo: null });
    expect(planValidity({ validTo: null }, NOW)).toEqual({
      validFrom: NOW,
      validTo: null,
    });
  });

  it('accepts validFrom exactly now − 60 s and rejects one millisecond earlier', () => {
    expect(OFFER_START_TOLERANCE_MS).toBe(60_000);
    const edge = at(-60_000);
    expect(planValidity({ validFrom: edge }, NOW).validFrom).toBe(edge);

    const error = errorOf(() => planValidity({ validFrom: at(-60_001) }, NOW));
    expect(error).toBeInstanceOf(OfferError);
    expect(error.status).toBe(400);
    expect(error.details?.issues?.map((issue) => issue.path)).toEqual([
      ['validFrom'],
    ]);
  });

  it('accepts a future validFrom and a validTo one millisecond after validFrom', () => {
    const validFrom = at(HOUR);
    const validTo = new Date(validFrom.getTime() + 1);
    expect(planValidity({ validFrom, validTo }, NOW)).toEqual({
      validFrom,
      validTo,
    });
  });

  it('rejects validTo equal to or before the effective validFrom with path validTo', () => {
    const validFrom = at(HOUR);
    for (const validTo of [validFrom, new Date(validFrom.getTime() - 1)]) {
      const error = errorOf(() => planValidity({ validFrom, validTo }, NOW));
      expect(error.status).toBe(400);
      expect(error.details?.issues?.map((issue) => issue.path)).toEqual([
        ['validTo'],
      ]);
    }
    // validFrom chybí → efektivní validFrom je now
    const error = errorOf(() => planValidity({ validTo: NOW }, NOW));
    expect(error.details?.issues?.map((issue) => issue.path)).toEqual([
      ['validTo'],
    ]);
  });

  it('reports both errors together', () => {
    const validFrom = at(-5 * 60_000);
    const error = errorOf(() =>
      planValidity(
        { validFrom, validTo: new Date(validFrom.getTime() - 1) },
        NOW,
      ),
    );
    expect(error.status).toBe(400);
    expect(error.message).toBe('Validation failed');
    expect(error.details?.issues?.map((issue) => issue.path)).toEqual([
      ['validFrom'],
      ['validTo'],
    ]);
    for (const issue of error.details!.issues!)
      expect(issue.code).toBe('custom');
  });

  it('rejects validTo that is not after now even when it is after validFrom (never creates an already ended offer)', () => {
    const validFrom = at(-30_000);
    for (const validTo of [at(-10_000), NOW]) {
      const error = errorOf(() => planValidity({ validFrom, validTo }, NOW));
      expect(error.status).toBe(400);
      expect(error.details?.issues?.map((issue) => issue.path)).toEqual([
        ['validTo'],
      ]);
    }
    const validTo = at(1);
    expect(planValidity({ validFrom, validTo }, NOW)).toEqual({
      validFrom,
      validTo,
    });
  });
});

/** Paměťový repozitář se stejnou sémantikou podmíněných zápisů jako Mongo. */
function memoryRepository(initial: AnimalOffers[] = []) {
  const animals = new Map(
    initial.map((entry) => [
      entry.animalId,
      { ...entry, offers: [...entry.offers] },
    ]),
  );
  const blocking = (offer: OfferRecord, now: Date) =>
    canWithdraw(offerStatus(offer, now));
  const repository: OfferRepository = {
    load: vi.fn(async (animalId: string) => {
      const found = animals.get(animalId);
      return found ? { ...found, offers: [...found.offers] } : null;
    }),
    append: vi.fn(async (offer: OfferRecord, now: Date) => {
      const found = animals.get(offer.animalId);
      if (
        !found ||
        found.ownerUserId !== offer.ownerUserId ||
        found.offers.some((existing) => blocking(existing, now))
      )
        return false;
      found.offers.push(offer);
      return true;
    }),
    listByOwner: vi.fn(async (ownerUserId: string) =>
      [...animals.values()]
        .filter((entry) => entry.ownerUserId === ownerUserId)
        .flatMap((entry) =>
          entry.offers.map((offer) => ({
            offer,
            animal: { ...animal, id: entry.animalId },
          })),
        ),
    ),
    findOwned: vi.fn(async (offerId: string, ownerUserId: string) => {
      for (const entry of animals.values())
        if (entry.ownerUserId === ownerUserId) {
          const offer = entry.offers.find((o) => o.id === offerId);
          if (offer) return offer;
        }
      return null;
    }),
    withdraw: vi.fn(
      async (
        offerId: string,
        ownerUserId: string,
        withdrawal: { at: Date; by: string },
      ) => {
        for (const entry of animals.values())
          if (entry.ownerUserId === ownerUserId) {
            const index = entry.offers.findIndex(
              (o) => o.id === offerId && blocking(o, withdrawal.at),
            );
            if (index >= 0) {
              const updated = {
                ...entry.offers[index]!,
                withdrawnAt: withdrawal.at,
                withdrawnBy: withdrawal.by,
              };
              entry.offers[index] = updated;
              return updated;
            }
          }
        return null;
      },
    ),
  };
  return { repository, animals };
}

function useCases(
  repository: OfferRepository,
  options: {
    isVerified?: (userId: string) => Promise<boolean>;
    now?: () => Date;
  } = {},
) {
  let id = 0;
  const verification = {
    isVerified: vi.fn(options.isVerified ?? (async () => true)),
  };
  return {
    verification,
    offers: offerUseCases({
      repository,
      verification,
      newId: () => `f${String(++id).padStart(23, '0')}`,
      now: options.now ?? (() => NOW),
    }),
  };
}

const input = (
  overrides: Partial<CreateOfferInput> = {},
): CreateOfferInput => ({
  animalId: ANIMAL_ID,
  regionId: 'praha',
  ...overrides,
});
const body = (value: CreateOfferInput) => async () => value;
const myAnimal = (offers: OfferRecord[] = []): AnimalOffers => ({
  animalId: ANIMAL_ID,
  ownerUserId: owner.userId,
  offers,
});

describe('offer creation', () => {
  it('stores an immediate offer with server time, audit fields and null defaults', async () => {
    const { repository, animals } = memoryRepository([myAnimal()]);
    const { offers } = useCases(repository);

    const view = await offers.create(owner, body(input({ message: 'Ahoj' })));

    expect(view.status).toBe('ACTIVE');
    expect(view.canWithdraw).toBe(true);
    expect(view.offer).toMatchObject({
      animalId: ANIMAL_ID,
      ownerUserId: owner.userId,
      regionId: 'praha',
      validFrom: NOW,
      validTo: null,
      message: 'Ahoj',
      createdAt: NOW,
      createdBy: owner.userId,
      withdrawnAt: null,
      withdrawnBy: null,
    });
    expect(animals.get(ANIMAL_ID)!.offers).toEqual([view.offer]);
    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(repository.append).toHaveBeenCalledWith(view.offer, NOW);
  });

  it('takes the owner from the identity, not from the input, and normalises the animal id to lower case', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    const { offers } = useCases(repository);
    const hex = 'ABCDEF0123456789ABCDEF01';
    const upper = memoryRepository([
      { animalId: hex.toLowerCase(), ownerUserId: owner.userId, offers: [] },
    ]);
    const view = await useCases(upper.repository).offers.create(
      owner,
      body(input({ animalId: hex })),
    );
    expect(view.offer.animalId).toBe(hex.toLowerCase());
    expect(view.offer.ownerUserId).toBe(owner.userId);
    await expect(offers.create(stranger, body(input()))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('plans a scheduled offer with an end and rejects a validFrom older than the tolerance', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    const { offers } = useCases(repository);
    const view = await offers.create(
      owner,
      body(
        input({
          validFrom: at(HOUR).toISOString(),
          validTo: at(2 * HOUR).toISOString(),
        }),
      ),
    );
    expect(view.status).toBe('SCHEDULED');
    expect(view.offer.validTo).toEqual(at(2 * HOUR));

    const other = memoryRepository([myAnimal()]);
    await expect(
      useCases(other.repository).offers.create(
        owner,
        body(input({ validFrom: at(-5 * 60_000).toISOString() })),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: { issues: [{ path: ['validFrom'] }] },
    });
    expect(other.repository.append).not.toHaveBeenCalled();
  });

  it('treats a missing animal and a foreign animal identically as 404 Animal not found without writing', async () => {
    const foreign = memoryRepository([
      { animalId: ANIMAL_ID, ownerUserId: stranger.userId, offers: [] },
    ]);
    const missing = memoryRepository();
    for (const { repository } of [foreign, missing]) {
      const { offers } = useCases(repository);
      const error = await offers
        .create(owner, body(input()))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OfferError);
      expect(error).toMatchObject({ status: 404, message: 'Animal not found' });
      expect(repository.append).not.toHaveBeenCalled();
    }
  });

  it('answers 409 with the current blocking offer for both ACTIVE and SCHEDULED offers', async () => {
    for (const validFrom of [at(-HOUR), at(HOUR)]) {
      const existing = record({ id: 'e'.repeat(24), validFrom });
      const { repository } = memoryRepository([myAnimal([existing])]);
      const { offers } = useCases(repository);
      const error = await offers
        .create(owner, body(input()))
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        status: 409,
        message: 'Animal already has an active offer',
        details: {
          current: {
            id: existing.id,
            status: validFrom > NOW ? 'SCHEDULED' : 'ACTIVE',
          },
        },
      });
      expect(repository.append).toHaveBeenCalledTimes(1);
    }
  });

  it('does not let withdrawn or expired offers block a new one', async () => {
    const history = [
      record({
        id: 'a'.repeat(24),
        withdrawnAt: at(-1),
        withdrawnBy: owner.userId,
      }),
      record({ id: 'b'.repeat(24), validTo: at(0) }),
    ];
    const { repository, animals } = memoryRepository([myAnimal(history)]);
    const view = await useCases(repository).offers.create(owner, body(input()));
    expect(animals.get(ANIMAL_ID)!.offers).toHaveLength(3);
    expect(view.status).toBe('ACTIVE');
  });

  it('retries append when the blocking offer vanished between append and the re-read', async () => {
    const stale = record({ id: 'e'.repeat(24) });
    const { repository, animals } = memoryRepository([myAnimal()]);
    // první append selže (v tu chvíli nabídka blokovala), ale při opětovném čtení už neblokuje
    vi.mocked(repository.append).mockImplementationOnce(async () => false);
    const loads: AnimalOffers[] = [
      myAnimal(),
      myAnimal([{ ...stale, withdrawnAt: at(-1), withdrawnBy: owner.userId }]),
    ];
    vi.mocked(repository.load)
      .mockResolvedValueOnce(loads[0]!) // první čtení: zvíře je moje
      .mockResolvedValueOnce(loads[1]!); // čtení po neúspěšném zápisu

    const view = await useCases(repository).offers.create(owner, body(input()));

    expect(view.status).toBe('ACTIVE');
    expect(repository.append).toHaveBeenCalledTimes(2);
    expect(repository.load).toHaveBeenCalledTimes(2);
    expect(animals.get(ANIMAL_ID)!.offers).toEqual([view.offer]);
  });

  it('gives up with 409 (no current) after three failed appends when nothing blocks', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    vi.mocked(repository.append).mockResolvedValue(false);
    const error = await useCases(repository)
      .offers.create(owner, body(input()))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 409,
      message: 'Animal already has an active offer',
    });
    expect((error as OfferError).details).toBeUndefined();
    expect(repository.append).toHaveBeenCalledTimes(3);
  });

  it('answers 404 when the animal disappears or changes owner after a failed append', async () => {
    for (const afterFailure of [
      null,
      { animalId: ANIMAL_ID, ownerUserId: stranger.userId, offers: [] },
    ]) {
      const { repository } = memoryRepository([myAnimal()]);
      vi.mocked(repository.append).mockResolvedValue(false);
      vi.mocked(repository.load)
        .mockResolvedValueOnce(myAnimal())
        .mockResolvedValueOnce(afterFailure);
      await expect(
        useCases(repository).offers.create(owner, body(input())),
      ).rejects.toMatchObject({ status: 404, message: 'Animal not found' });
      expect(repository.append).toHaveBeenCalledTimes(1);
    }
  });

  it('uses a single reading of the clock per operation', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    const now = vi.fn(() => NOW);
    const { offers } = useCases(repository, { now });
    await offers.create(owner, body(input()));
    expect(now).toHaveBeenCalledTimes(1);
    await offers.listMine(owner);
    expect(now).toHaveBeenCalledTimes(2);
    await offers.withdraw(owner, 'f'.repeat(24)).catch(() => undefined);
    expect(now).toHaveBeenCalledTimes(3);
  });
});

describe('create after a failed append evaluates against a fresh clock reading', () => {
  /** První čtení hodin je čas operace, další jsou čerstvé (po neúspěšném zápisu). */
  const clockOf = (...readings: Date[]) => {
    let index = 0;
    return vi.fn(() => readings[Math.min(index++, readings.length - 1)]!);
  };

  it('answers 400 for a validTo in the past (after validFrom) without any repository write', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    await expect(
      useCases(repository).offers.create(
        owner,
        body(
          input({
            validFrom: at(-30_000).toISOString(),
            validTo: at(-10_000).toISOString(),
          }),
        ),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: { issues: [{ path: ['validTo'] }] },
    });
    expect(repository.append).not.toHaveBeenCalled();
  });

  it('reports the blocking offer with the status at the later reading (SCHEDULED at first, ACTIVE later)', async () => {
    const blocker = record({
      id: 'e'.repeat(24),
      validFrom: at(1_000),
      createdAt: at(-HOUR),
    });
    const { repository } = memoryRepository([myAnimal([blocker])]);
    const now = clockOf(NOW, at(2_000));

    const error = await useCases(repository, { now })
      .offers.create(owner, body(input()))
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      status: 409,
      details: { current: { id: blocker.id, status: 'ACTIVE' } },
    });
    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(repository.append).toHaveBeenCalledWith(expect.anything(), NOW);
  });

  it('retries with the later time when the blocking offer expired between the readings', async () => {
    const blocker = record({
      id: 'e'.repeat(24),
      validTo: at(1_000),
      createdAt: at(-HOUR),
    });
    const { repository, animals } = memoryRepository([myAnimal([blocker])]);
    const now = clockOf(NOW, at(2_000));

    const view = await useCases(repository, { now }).offers.create(
      owner,
      body(input()),
    );

    expect(repository.append).toHaveBeenCalledTimes(2);
    expect(repository.append).toHaveBeenNthCalledWith(1, view.offer, NOW);
    expect(repository.append).toHaveBeenNthCalledWith(2, view.offer, at(2_000));
    // záznam nabídky drží čas prvního čtení, stav odpovědi se počítá k poslednímu
    expect(view.offer.createdAt).toEqual(NOW);
    expect(view.offer.validFrom).toEqual(NOW);
    expect(view.status).toBe('ACTIVE');
    expect(animals.get(ANIMAL_ID)!.offers).toHaveLength(2);
  });
});

describe('UC04-LST-3 listMine ordering', () => {
  it('puts ACTIVE/SCHEDULED first, then others, newest createdAt first inside each group', async () => {
    const mk = (
      id: string,
      createdAtOffset: number,
      rest: Partial<OfferRecord>,
    ) => record({ id: id.repeat(24), createdAt: at(createdAtOffset), ...rest });
    const second = '000000000000000000000002';
    const { repository } = memoryRepository([
      myAnimal([
        mk('1', -10 * HOUR, { withdrawnAt: at(-9 * HOUR) }), // WITHDRAWN, starší
        mk('2', -5 * HOUR, { validTo: at(-4 * HOUR) }), // EXPIRED, novější
        mk('3', -8 * HOUR, { validTo: at(-HOUR) }), // EXPIRED, starší než '2'
      ]),
      {
        animalId: second,
        ownerUserId: owner.userId,
        offers: [
          mk('4', -20 * HOUR, { animalId: second, validFrom: at(HOUR) }), // SCHEDULED, nejstarší
          mk('5', -2 * HOUR, { animalId: second }), // ACTIVE, nejnovější
        ],
      },
      {
        animalId: '000000000000000000000003',
        ownerUserId: stranger.userId,
        offers: [mk('6', -HOUR, { ownerUserId: stranger.userId })],
      },
    ]);

    const list = await useCases(repository).offers.listMine(owner);

    expect(list.map((entry) => entry.offer.id[0])).toEqual([
      '5',
      '4',
      '2',
      '3',
      '1',
    ]);
    expect(list.map((entry) => entry.status)).toEqual([
      'ACTIVE',
      'SCHEDULED',
      'EXPIRED',
      'EXPIRED',
      'WITHDRAWN',
    ]);
    expect(list.map((entry) => entry.canWithdraw)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(list[0]!.animal.id).toBe(second);
    expect(repository.listByOwner).toHaveBeenCalledWith(owner.userId);
    expect(repository.listByOwner).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list for a breeder without offers', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    expect(await useCases(repository).offers.listMine(owner)).toEqual([]);
  });
});

describe('withdrawal', () => {
  const offerId = 'e'.repeat(24);

  it('withdraws an ACTIVE and a SCHEDULED offer with server time and the actor as audit', async () => {
    for (const validFrom of [at(-HOUR), at(HOUR)]) {
      const { repository, animals } = memoryRepository([
        myAnimal([record({ id: offerId, validFrom })]),
      ]);
      const view = await useCases(repository).offers.withdraw(owner, offerId);
      expect(view.status).toBe('WITHDRAWN');
      expect(view.canWithdraw).toBe(false);
      expect(view.offer.withdrawnAt).toEqual(NOW);
      expect(view.offer.withdrawnBy).toBe(owner.userId);
      expect(repository.withdraw).toHaveBeenCalledWith(offerId, owner.userId, {
        at: NOW,
        by: owner.userId,
      });
      expect(animals.get(ANIMAL_ID)!.offers[0]!.withdrawnAt).toEqual(NOW);
      expect(repository.findOwned).not.toHaveBeenCalled();
    }
  });

  it('answers 404 Offer not found for a missing and for a foreign offer', async () => {
    const { repository, animals } = memoryRepository([
      myAnimal([record({ id: offerId })]),
    ]);
    const { offers } = useCases(repository);
    for (const [actor, id] of [
      [owner, '9'.repeat(24)],
      [stranger, offerId],
    ] as const) {
      const error = await offers.withdraw(actor, id).catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 404, message: 'Offer not found' });
    }
    expect(animals.get(ANIMAL_ID)!.offers[0]!.withdrawnAt).toBeNull();
  });

  it('answers 409 with current status for already withdrawn and for expired offers', async () => {
    const { repository } = memoryRepository([
      myAnimal([
        record({ id: offerId, withdrawnAt: at(-1), withdrawnBy: owner.userId }),
        record({ id: 'd'.repeat(24), validTo: at(0) }),
      ]),
    ]);
    const { offers } = useCases(repository);
    expect(
      await offers.withdraw(owner, offerId).catch((e: unknown) => e),
    ).toMatchObject({
      status: 409,
      message: 'Offer cannot be withdrawn',
      details: { current: { id: offerId, status: 'WITHDRAWN' } },
    });
    expect(
      await offers.withdraw(owner, 'd'.repeat(24)).catch((e: unknown) => e),
    ).toMatchObject({
      status: 409,
      details: { current: { id: 'd'.repeat(24), status: 'EXPIRED' } },
    });
  });
});

describe('UC04-ACC guard', () => {
  const calls = {
    create: (
      offers: ReturnType<typeof useCases>['offers'],
      actor?: typeof owner,
    ) => offers.create(actor, body(input())),
    listMine: (
      offers: ReturnType<typeof useCases>['offers'],
      actor?: typeof owner,
    ) => offers.listMine(actor),
    withdraw: (
      offers: ReturnType<typeof useCases>['offers'],
      actor?: typeof owner,
    ) => offers.withdraw(actor, 'e'.repeat(24)),
  };

  it.each(Object.keys(calls) as (keyof typeof calls)[])(
    '%s: 401 without identity, 403 when unverified, 503 when verification fails; the repository is untouched',
    async (name) => {
      const { repository } = memoryRepository([myAnimal()]);
      const untouched = () => {
        for (const fn of Object.values(repository))
          expect(fn).not.toHaveBeenCalled();
      };

      const anonymous = useCases(repository);
      const e401 = await calls[name](anonymous.offers).catch((e: unknown) => e);
      expect(e401).toBeInstanceOf(AuthorizationError);
      expect(e401).toMatchObject({ status: 401 });
      expect(anonymous.verification.isVerified).not.toHaveBeenCalled();

      const unverified = useCases(repository, {
        isVerified: async () => false,
      });
      const e403 = await calls[name](unverified.offers, owner).catch(
        (e: unknown) => e,
      );
      expect(e403).toBeInstanceOf(AnimalError);
      expect(e403).toMatchObject({ status: 403 });
      expect(unverified.verification.isVerified).toHaveBeenCalledWith(
        owner.userId,
      );

      const broken = useCases(repository, {
        isVerified: async () => {
          throw new Error('projection read failed');
        },
      });
      const e503 = await calls[name](broken.offers, owner).catch(
        (e: unknown) => e,
      );
      expect(e503).toBeInstanceOf(AnimalError);
      expect(e503).toMatchObject({ status: 503 });
      untouched();
    },
  );

  it('does not read the request body for an unverified breeder, nor without identity', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    const readInput = vi.fn(async () => input());
    const unverified = useCases(repository, { isVerified: async () => false });
    await expect(
      unverified.offers.create(owner, readInput),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      unverified.offers.create(undefined, readInput),
    ).rejects.toMatchObject({ status: 401 });
    const broken = useCases(repository, {
      isVerified: async () => {
        throw new Error('down');
      },
    });
    await expect(broken.offers.create(owner, readInput)).rejects.toMatchObject({
      status: 503,
    });
    expect(readInput).not.toHaveBeenCalled();
  });

  it('reads the body once for a verified breeder', async () => {
    const { repository } = memoryRepository([myAnimal()]);
    const readInput = vi.fn(async () => input());
    await useCases(repository).offers.create(owner, readInput);
    expect(readInput).toHaveBeenCalledTimes(1);
  });
});
