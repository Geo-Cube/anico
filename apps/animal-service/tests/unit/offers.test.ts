import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import {
  InquiryUnavailableReasonSchema,
  type CreateInquiryInput,
  type CreateOfferInput,
  type InquiryUnavailableReason,
  type OfferStatus,
} from '@anico/shared-schemas';
import type { FileStorage } from '../../src/files/file-storage.js';
import { offerUseCases } from '../../src/modules/offers/application/offers.js';
import {
  OFFER_START_TOLERANCE_MS,
  OfferError,
  canWithdraw,
  hasPendingInquiry,
  inquiryAvailability,
  offerStatus,
  offerVisibleTo,
  planValidity,
  type OfferRecord,
} from '../../src/modules/offers/domain/offer.js';
import type {
  AnimalOffers,
  OfferAnimal,
  OfferDetailAnimal,
  OfferRepository,
} from '../../src/modules/offers/domain/ports.js';
import {
  AnimalError,
  type AnimalPhoto,
} from '../../src/modules/animal/domain/entity.js';

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
  const detailAnimals = new Map<string, OfferDetailAnimal>();
  const photoRecords = new Map<string, AnimalPhoto[]>();
  const storedInquiries: {
    offerId: string;
    senderBreederId: string;
    status: 'PENDING' | 'EXPIRED';
  }[] = [];
  const animals = new Map(
    initial.map((entry) => [
      entry.animalId,
      { ...entry, offers: [...entry.offers] },
    ]),
  );
  const blocking = (offer: OfferRecord, now: Date) =>
    canWithdraw(offerStatus(offer, now));
  const repository: OfferRepository = {
    findActive: vi.fn(),
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
    findForInquiry: vi.fn(async (offerId: string) => {
      for (const entry of animals.values()) {
        const offer = entry.offers.find((item) => item.id === offerId);
        if (offer)
          return {
            animalId: entry.animalId,
            animalName: animal.name,
            ownerUserId: entry.ownerUserId,
            offer,
          };
      }
      return null;
    }),
    findDetail: vi.fn(async (offerId: string, viewerUserId: string) => {
      for (const entry of animals.values()) {
        const offer = entry.offers.find((item) => item.id === offerId);
        if (offer)
          return {
            offer,
            animal: detailAnimals.get(entry.animalId) ?? detailAnimal(),
            // stejná sémantika jako Mongo: jen poptávky čtenáře, jen `status`
            viewerInquiries: storedInquiries
              .filter(
                (item) =>
                  item.offerId === offerId &&
                  item.senderBreederId === viewerUserId,
              )
              .map(({ status }) => ({ status })),
          };
      }
      return null;
    }),
    findPhoto: vi.fn(async (offerId: string, photoId: string) => {
      for (const entry of animals.values()) {
        const offer = entry.offers.find((item) => item.id === offerId);
        if (offer)
          return {
            offer,
            photo:
              photoRecords
                .get(entry.animalId)
                ?.find((photo) => photo.id === photoId) ?? null,
          };
      }
      return null;
    }),
    appendInquiry: vi.fn(async (target, inquiry, senderBreederId, now) => {
      const entry = animals.get(target.animalId);
      if (
        !entry ||
        entry.ownerUserId !== target.ownerUserId ||
        entry.ownerUserId === senderBreederId
      )
        return false;
      const offer = entry.offers.find((item) => item.id === target.offer.id);
      if (!offer || offer.withdrawnAt || offerStatus(offer, now) !== 'ACTIVE')
        return false;
      const stored = (offer as OfferRecord & { inquiries?: unknown[] })
        .inquiries;
      const inquiries = stored ?? [];
      if (
        inquiries.some(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            'senderBreederId' in item &&
            item.senderBreederId === senderBreederId &&
            'status' in item &&
            item.status === 'PENDING',
        )
      )
        return false;
      (offer as OfferRecord & { inquiries: unknown[] }).inquiries = [
        ...inquiries,
        {
          id: inquiry.id,
          senderBreederId,
          message: inquiry.message,
          status: inquiry.status,
          submittedAt: inquiry.submittedAt,
        },
      ];
      return true;
    }),
  };
  return { repository, animals, detailAnimals, photoRecords, storedInquiries };
}

/** Zvíře v detailu nabídky s prázdnými volitelnými údaji; `overrides` přepisují jednotlivá pole. */
function detailAnimal(
  overrides: Partial<OfferDetailAnimal> = {},
): OfferDetailAnimal {
  return {
    name: 'Luna',
    species: 'dog',
    breedId: 'aljassky-malamut',
    sex: 'female',
    birthDate: null,
    coatColor: null,
    weightKg: null,
    city: null,
    pedigreeNumber: null,
    microchipNumber: null,
    description: null,
    photos: [],
    documents: [],
    ...overrides,
  };
}

/** Fotografie zvířete s originálem a oběma zmenšeninami (soubory jsou jen reference ve fake úložišti). */
function storedPhoto(
  id: string,
  overrides: Partial<AnimalPhoto> = {},
): AnimalPhoto {
  return {
    id,
    file: {
      fileName: 'puvodni-nazev.png',
      fileReference: `original-${id}`,
      contentType: 'image/png',
      size: 100,
    },
    variants: {
      thumbnail: { fileReference: `thumbnail-${id}`, size: 10 },
      preview: { fileReference: `preview-${id}`, size: 20 },
    },
    isPrimary: true,
    ...overrides,
  };
}

/** Fake úložiště: `open` vrací proud s obsahem rovným referenci, takže je vidět, odkud se četlo. */
function fakeStorage() {
  const storage: FileStorage = {
    save: vi.fn(async () => {
      throw new Error('save is not expected');
    }),
    open: vi.fn(async (fileReference: string) => ({
      stream: Readable.from([Buffer.from(fileReference)]),
      size: fileReference.length,
    })),
    delete: vi.fn(async () => undefined),
  };
  return storage;
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
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
  const photos = fakeStorage();
  const photoVariants = fakeStorage();
  /** Fake zmenšování: obsah zmenšeniny prozradí velikost i zdroj (`<size>-of-<originál>`). */
  const resizer = {
    variants: vi.fn(async (content: Buffer) => ({
      thumbnail: Buffer.from(`thumbnail-of-${content.toString()}`),
      preview: Buffer.from(`preview-of-${content.toString()}`),
    })),
  };
  return {
    verification,
    photos,
    photoVariants,
    resizer,
    offers: offerUseCases({
      repository,
      verification,
      photos,
      photoVariants,
      resizer,
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

describe('UC-07 submit inquiry', () => {
  const activeForeignOffer = () =>
    record({
      id: 'e'.repeat(24),
      ownerUserId: stranger.userId,
      validFrom: at(-HOUR),
      validTo: null,
    });

  it('stores a PENDING inquiry for an active foreign offer', async () => {
    const foreign = activeForeignOffer();
    const { repository, animals } = memoryRepository([
      {
        animalId: ANIMAL_ID,
        ownerUserId: stranger.userId,
        offers: [foreign],
      },
    ]);
    const readInput = vi.fn(async (): Promise<CreateInquiryInput> => ({
      message: 'Zajímá mě krytí',
    }));

    const submitted = await useCases(repository).offers.submitInquiry(
      owner,
      foreign.id,
      readInput,
    );

    expect(submitted).toMatchObject({
      inquiry: {
        offerId: foreign.id,
        senderBreederId: owner.userId,
        message: 'Zajímá mě krytí',
        status: 'PENDING',
        submittedAt: NOW,
      },
      animalName: animal.name,
      regionId: foreign.regionId,
    });
    expect(readInput).toHaveBeenCalledTimes(1);
    expect(repository.appendInquiry).toHaveBeenCalledTimes(1);
    expect(
      (
        animals.get(ANIMAL_ID)!.offers[0] as OfferRecord & {
          inquiries: unknown[];
        }
      ).inquiries,
    ).toHaveLength(1);
  });

  it('rejects an own offer, inactive offer and duplicate pending inquiry', async () => {
    const own = record({ id: '1'.repeat(24), ownerUserId: owner.userId });
    const ownRepository = memoryRepository([
      { animalId: ANIMAL_ID, ownerUserId: owner.userId, offers: [own] },
    ]);
    await expect(
      useCases(ownRepository.repository).offers.submitInquiry(
        owner,
        own.id,
        async () => ({ message: 'Ahoj' }),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const expired = record({
      id: '2'.repeat(24),
      ownerUserId: stranger.userId,
      validTo: at(-1),
    });
    const expiredRepository = memoryRepository([
      { animalId: ANIMAL_ID, ownerUserId: stranger.userId, offers: [expired] },
    ]);
    await expect(
      useCases(expiredRepository.repository).offers.submitInquiry(
        owner,
        expired.id,
        async () => ({ message: 'Ahoj' }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    const foreign = activeForeignOffer();
    const duplicateRepository = memoryRepository([
      { animalId: ANIMAL_ID, ownerUserId: stranger.userId, offers: [foreign] },
    ]);
    const duplicateUseCases = useCases(duplicateRepository.repository);
    await duplicateUseCases.offers.submitInquiry(
      owner,
      foreign.id,
      async () => ({
        message: 'První',
      }),
    );
    await expect(
      duplicateUseCases.offers.submitInquiry(owner, foreign.id, async () => ({
        message: 'Druhá',
      })),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects an unverified offer owner without writing', async () => {
    const foreign = activeForeignOffer();
    const { repository } = memoryRepository([
      { animalId: ANIMAL_ID, ownerUserId: stranger.userId, offers: [foreign] },
    ]);
    const result = useCases(repository, {
      isVerified: async (userId) => userId === owner.userId,
    }).offers.submitInquiry(owner, foreign.id, async () => ({
      message: 'Ahoj',
    }));

    await expect(result).rejects.toMatchObject({
      status: 403,
      message: 'Offer owner is not verified',
    });
    expect(repository.appendInquiry).not.toHaveBeenCalled();
  });
});

/** Pole nabídky, která v `NOW` dávají daný stav (ověřeno v testu `STATUS_FIELDS`). */
const STATUS_FIELDS: Record<OfferStatus, Partial<OfferRecord>> = {
  SCHEDULED: { validFrom: at(HOUR) },
  ACTIVE: {},
  WITHDRAWN: { withdrawnAt: at(-1), withdrawnBy: owner.userId },
  EXPIRED: { validFrom: at(-2 * HOUR), validTo: at(-1) },
};
const STATUSES = Object.keys(STATUS_FIELDS) as OfferStatus[];
const OFFER_ID = 'd'.repeat(24);
const third = testIdentity({ roles: ['breeder'] });

describe('UC06 fixtures', () => {
  it.each(STATUSES)('STATUS_FIELDS yields %s at NOW', (status) => {
    expect(offerStatus(record(STATUS_FIELDS[status]), NOW)).toBe(status);
  });
});

describe('UC06-VIS-4 offerVisibleTo', () => {
  it.each(STATUSES)(
    '%s: the owner always sees it, others only when ACTIVE',
    (status) => {
      expect(offerVisibleTo(status, true)).toBe(true);
      expect(offerVisibleTo(status, false)).toBe(status === 'ACTIVE');
    },
  );
});

describe('UC06-INQ-7 hasPendingInquiry', () => {
  it('is false for no inquiries and for expired ones only', () => {
    expect(hasPendingInquiry([])).toBe(false);
    expect(hasPendingInquiry([{ status: 'EXPIRED' }])).toBe(false);
    expect(
      hasPendingInquiry([{ status: 'EXPIRED' }, { status: 'EXPIRED' }]),
    ).toBe(false);
  });

  it('is true when at least one inquiry is pending', () => {
    expect(hasPendingInquiry([{ status: 'PENDING' }])).toBe(true);
    expect(
      hasPendingInquiry([{ status: 'EXPIRED' }, { status: 'PENDING' }]),
    ).toBe(true);
  });
});

describe('UC06-INQ-1/2/6 inquiryAvailability', () => {
  it('lets only a foreign reader without a pending inquiry send one to an ACTIVE offer', () => {
    expect(
      inquiryAvailability({
        isOwner: false,
        status: 'ACTIVE',
        pendingInquiry: false,
      }),
    ).toEqual({ canSendInquiry: true, reason: null });
  });

  it('applies the priority OWN_OFFER > NOT_ACTIVE > INQUIRY_PENDING', () => {
    expect(
      inquiryAvailability({
        isOwner: true,
        status: 'SCHEDULED',
        pendingInquiry: true,
      }),
    ).toEqual({ canSendInquiry: false, reason: 'OWN_OFFER' });
    expect(
      inquiryAvailability({
        isOwner: true,
        status: 'ACTIVE',
        pendingInquiry: false,
      }),
    ).toEqual({ canSendInquiry: false, reason: 'OWN_OFFER' });
    expect(
      inquiryAvailability({
        isOwner: false,
        status: 'WITHDRAWN',
        pendingInquiry: true,
      }),
    ).toEqual({ canSendInquiry: false, reason: 'NOT_ACTIVE' });
    expect(
      inquiryAvailability({
        isOwner: false,
        status: 'ACTIVE',
        pendingInquiry: true,
      }),
    ).toEqual({ canSendInquiry: false, reason: 'INQUIRY_PENDING' });
  });

  it.each(['SCHEDULED', 'WITHDRAWN', 'EXPIRED'] as const)(
    'a foreign reader of a %s offer gets NOT_ACTIVE with or without a pending inquiry',
    (status) => {
      for (const pendingInquiry of [false, true])
        expect(
          inquiryAvailability({ isOwner: false, status, pendingInquiry }),
        ).toEqual({ canSendInquiry: false, reason: 'NOT_ACTIVE' });
    },
  );

  it('keeps canSendInquiry === (reason === null) in all 16 combinations and allows exactly one', () => {
    let allowed = 0;
    for (const isOwner of [false, true])
      for (const status of STATUSES)
        for (const pendingInquiry of [false, true]) {
          const result = inquiryAvailability({
            isOwner,
            status,
            pendingInquiry,
          });
          expect(result.canSendInquiry).toBe(result.reason === null);
          if (result.reason !== null)
            expect(
              InquiryUnavailableReasonSchema.safeParse(result.reason),
            ).toHaveProperty('success', true);
          if (result.canSendInquiry) allowed += 1;
        }
    expect(allowed).toBe(1);
  });
});

describe('UC06 detail use case', () => {
  const foreign = (status: OfferStatus = 'ACTIVE') =>
    record({ id: OFFER_ID, ...STATUS_FIELDS[status] });
  const seeded = (status: OfferStatus = 'ACTIVE') =>
    memoryRepository([
      {
        animalId: ANIMAL_ID,
        ownerUserId: owner.userId,
        offers: [foreign(status)],
      },
    ]);

  it('UC06-ACC: 401 without identity, 403 when unverified, 503 when verification fails; the repository is untouched', async () => {
    const { repository } = seeded();
    const untouched = () => {
      for (const fn of Object.values(repository))
        expect(fn).not.toHaveBeenCalled();
    };
    const calls = {
      detail: (
        offers: ReturnType<typeof useCases>['offers'],
        actor?: typeof owner,
      ) => offers.detail(actor, OFFER_ID),
      openPhoto: (
        offers: ReturnType<typeof useCases>['offers'],
        actor?: typeof owner,
      ) => offers.openPhoto(actor, OFFER_ID, 'a'.repeat(24)),
    };
    for (const call of Object.values(calls)) {
      const anonymous = useCases(repository);
      const e401 = await call(anonymous.offers).catch((e: unknown) => e);
      expect(e401).toBeInstanceOf(AuthorizationError);
      expect(e401).toMatchObject({ status: 401 });
      expect(anonymous.verification.isVerified).not.toHaveBeenCalled();

      const unverified = useCases(repository, {
        isVerified: async () => false,
      });
      await expect(call(unverified.offers, stranger)).rejects.toMatchObject({
        status: 403,
      });
      expect(unverified.verification.isVerified).toHaveBeenCalledWith(
        stranger.userId,
      );

      const broken = useCases(repository, {
        isVerified: async () => {
          throw new Error('projection read failed');
        },
      });
      await expect(call(broken.offers, stranger)).rejects.toMatchObject({
        status: 503,
      });
      untouched();
    }
  });

  it('answers 404 Offer not found for a nonexistent offer', async () => {
    const { repository } = seeded();
    await expect(
      useCases(repository).offers.detail(stranger, 'c'.repeat(24)),
    ).rejects.toMatchObject({ status: 404, message: 'Offer not found' });
  });

  it.each(['SCHEDULED', 'WITHDRAWN', 'EXPIRED'] as const)(
    'UC06-VIS-3: a foreign reader gets the same 404 for a %s offer as for a nonexistent one',
    async (status) => {
      const { repository } = seeded(status);
      const { offers } = useCases(repository);
      const hidden = await offers
        .detail(stranger, OFFER_ID)
        .catch((e: unknown) => e);
      const missing = await offers
        .detail(stranger, 'c'.repeat(24))
        .catch((e: unknown) => e);
      expect(hidden).toBeInstanceOf(OfferError);
      expect(hidden).toMatchObject({ status: 404, message: 'Offer not found' });
      expect(hidden).toEqual(missing);
    },
  );

  it.each(STATUSES)(
    'UC06-VIS-1/INQ-1: the owner sees their %s offer with OWN_OFFER',
    async (status) => {
      const { repository } = seeded(status);
      const view = await useCases(repository).offers.detail(owner, OFFER_ID);
      expect(view).toMatchObject({
        status,
        canSendInquiry: false,
        inquiryUnavailableReason: 'OWN_OFFER',
      });
      expect(view.offer.id).toBe(OFFER_ID);
    },
  );

  it('UC06-VIS-2/INQ-3: a foreign reader sees an ACTIVE offer and may send an inquiry', async () => {
    const { repository } = seeded();
    const view = await useCases(repository).offers.detail(stranger, OFFER_ID);
    expect(view).toMatchObject({
      status: 'ACTIVE',
      canSendInquiry: true,
      inquiryUnavailableReason: null,
      verification: { verified: false, documentTypes: [] },
    });
  });

  it('reads the offer once with the reader id and one clock reading', async () => {
    const { repository } = seeded();
    const now = vi.fn(() => NOW);
    await useCases(repository, { now }).offers.detail(stranger, OFFER_ID);
    expect(repository.findDetail).toHaveBeenCalledTimes(1);
    expect(repository.findDetail).toHaveBeenCalledWith(
      OFFER_ID,
      stranger.userId,
    );
    expect(now).toHaveBeenCalledTimes(1);
    for (const name of [
      'load',
      'findOwned',
      'findForInquiry',
      'findPhoto',
    ] as const)
      expect(repository[name]).not.toHaveBeenCalled();
  });

  it('derives the status from the injected clock', async () => {
    const { repository } = seeded();
    const offers = (now: Date) =>
      useCases(repository, { now: () => now }).offers;
    await expect(offers(NOW).detail(stranger, OFFER_ID)).resolves.toMatchObject(
      {
        status: 'ACTIVE',
      },
    );
    await expect(
      offers(at(HOUR)).detail(stranger, OFFER_ID),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      useCases(
        memoryRepository([
          {
            animalId: ANIMAL_ID,
            ownerUserId: owner.userId,
            offers: [record({ id: OFFER_ID, validTo: at(HOUR) })],
          },
        ]).repository,
        { now: () => at(HOUR) },
      ).offers.detail(stranger, OFFER_ID),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('UC06-INQ-4: only the reader’s own PENDING inquiry blocks a new one', async () => {
    const { repository, storedInquiries } = seeded();
    storedInquiries.push(
      { offerId: OFFER_ID, senderBreederId: third.userId, status: 'PENDING' },
      {
        offerId: OFFER_ID,
        senderBreederId: stranger.userId,
        status: 'PENDING',
      },
    );
    const { offers } = useCases(repository);
    expect(await offers.detail(stranger, OFFER_ID)).toMatchObject({
      canSendInquiry: false,
      inquiryUnavailableReason: 'INQUIRY_PENDING',
    });
    const other = testIdentity({ roles: ['breeder'] });
    expect(await offers.detail(other, OFFER_ID)).toMatchObject({
      canSendInquiry: true,
      inquiryUnavailableReason: null,
    });
    expect(await offers.detail(third, OFFER_ID)).toMatchObject({
      inquiryUnavailableReason: 'INQUIRY_PENDING',
    });
  });

  it('UC06-INQ-5: an EXPIRED inquiry of the reader does not block', async () => {
    const { repository, storedInquiries } = seeded();
    storedInquiries.push({
      offerId: OFFER_ID,
      senderBreederId: stranger.userId,
      status: 'EXPIRED',
    });
    expect(
      await useCases(repository).offers.detail(stranger, OFFER_ID),
    ).toMatchObject({ canSendInquiry: true, inquiryUnavailableReason: null });
  });

  it('UC06-VER-1: documents become only a verification summary and never leave in the view', async () => {
    const { repository, detailAnimals } = seeded();
    detailAnimals.set(
      ANIMAL_ID,
      detailAnimal({
        photos: [
          { id: 'a'.repeat(24), isPrimary: false },
          { id: 'b'.repeat(24), isPrimary: true },
        ],
        documents: [
          {
            documentType: 'HEALTH_RESULTS',
            isCurrent: true,
            assessmentStatus: 'APPROVED',
          },
          {
            documentType: 'PEDIGREE',
            isCurrent: true,
            assessmentStatus: 'PENDING',
          },
          {
            documentType: 'BREEDING_APPROVAL',
            isCurrent: true,
            assessmentStatus: 'REJECTED',
          },
        ],
      }),
    );
    const view = await useCases(repository).offers.detail(stranger, OFFER_ID);
    expect(view.verification).toEqual({
      verified: true,
      documentTypes: ['HEALTH_RESULTS'],
    });
    expect(view.animal).not.toHaveProperty('documents');
    expect(view.animal.photos).toEqual([
      { id: 'a'.repeat(24), isPrimary: false },
      { id: 'b'.repeat(24), isPrimary: true },
    ]);
    expect(view).not.toHaveProperty('documents');
  });

  it('does not assemble the view for an invisible offer', async () => {
    const { repository, detailAnimals } = seeded('WITHDRAWN');
    // poškozená data zvířete by při skládání pohledu spadla na TypeError, ne na 404
    detailAnimals.set(ANIMAL_ID, {
      ...detailAnimal(),
      documents: undefined,
    } as unknown as OfferDetailAnimal);
    await expect(
      useCases(repository).offers.detail(stranger, OFFER_ID),
    ).rejects.toMatchObject({ status: 404, message: 'Offer not found' });
  });
});

describe('UC06 openPhoto use case', () => {
  const PHOTO_ID = 'a'.repeat(24);
  const setup = (
    status: OfferStatus = 'ACTIVE',
    photo: AnimalPhoto | null = storedPhoto(PHOTO_ID),
  ) => {
    const memory = memoryRepository([
      {
        animalId: ANIMAL_ID,
        ownerUserId: owner.userId,
        offers: [record({ id: OFFER_ID, ...STATUS_FIELDS[status] })],
      },
    ]);
    if (photo) memory.photoRecords.set(ANIMAL_ID, [photo]);
    return { ...memory, ...useCases(memory.repository) };
  };

  it('UC06-FIL-1/3: never opens the original; without size serves the preview JPEG of an ACTIVE foreign offer', async () => {
    const { offers, photos, photoVariants, resizer, repository } = setup();

    const preview = await offers.openPhoto(stranger, OFFER_ID, PHOTO_ID);
    expect(await readAll(preview.stream)).toBe(`preview-${PHOTO_ID}`);
    expect(preview.file.contentType).toBe('image/jpeg');

    const thumbnail = await offers.openPhoto(
      stranger,
      OFFER_ID,
      PHOTO_ID,
      'thumbnail',
    );
    expect(await readAll(thumbnail.stream)).toBe(`thumbnail-${PHOTO_ID}`);
    expect(thumbnail.file.contentType).toBe('image/jpeg');
    expect(photoVariants.open).toHaveBeenCalledWith(`thumbnail-${PHOTO_ID}`);
    expect(photos.open).not.toHaveBeenCalled();
    expect(resizer.variants).not.toHaveBeenCalled();
    expect(repository.findPhoto).toHaveBeenCalledWith(OFFER_ID, PHOTO_ID);
  });

  it('resizes the original of a photo without variants instead of serving it', async () => {
    const { offers, photoVariants, resizer } = setup(
      'ACTIVE',
      storedPhoto(PHOTO_ID, { variants: null }),
    );
    for (const size of [undefined, 'thumbnail', 'preview'] as const) {
      const opened = await offers.openPhoto(stranger, OFFER_ID, PHOTO_ID, size);
      const expected = `${size ?? 'preview'}-of-original-${PHOTO_ID}`;
      expect(await readAll(opened.stream)).toBe(expected);
      expect(opened.size).toBe(expected.length);
      expect(opened.file.contentType).toBe('image/jpeg');
    }
    expect(resizer.variants).toHaveBeenCalledTimes(3);
    expect(photoVariants.open).not.toHaveBeenCalled();
  });

  it('fails instead of serving an original that cannot be resized', async () => {
    const { offers, resizer } = setup(
      'ACTIVE',
      storedPhoto(PHOTO_ID, { variants: null }),
    );
    resizer.variants.mockResolvedValueOnce(null as never);
    await expect(
      offers.openPhoto(stranger, OFFER_ID, PHOTO_ID),
    ).rejects.toThrow('Stored photo cannot be resized');
  });

  it.each(STATUSES)(
    'UC06-FIL-1: the owner opens the preview of a photo of their %s offer',
    async (status) => {
      const { offers } = setup(status);
      const opened = await offers.openPhoto(owner, OFFER_ID, PHOTO_ID);
      expect(await readAll(opened.stream)).toBe(`preview-${PHOTO_ID}`);
    },
  );

  it.each(['SCHEDULED', 'WITHDRAWN', 'EXPIRED'] as const)(
    'UC06-FIL-2: a %s offer of someone else answers 404 and no storage is opened',
    async (status) => {
      const { offers, photos, photoVariants } = setup(status);
      for (const size of [undefined, 'thumbnail', 'preview'] as const)
        await expect(
          offers.openPhoto(stranger, OFFER_ID, PHOTO_ID, size),
        ).rejects.toMatchObject({ status: 404, message: 'Offer not found' });
      expect(photos.open).not.toHaveBeenCalled();
      expect(photoVariants.open).not.toHaveBeenCalled();
    },
  );

  it('UC06-FIL-2: the missing photo of an invisible offer does not reveal the offer', async () => {
    const { offers } = setup('WITHDRAWN', null);
    await expect(
      offers.openPhoto(stranger, OFFER_ID, PHOTO_ID),
    ).rejects.toMatchObject({ status: 404, message: 'Offer not found' });
  });

  it('UC06-FIL-4: a nonexistent offer is 404 Offer not found, a missing photo 404 Photo not found without opening storage', async () => {
    const { offers, photos, photoVariants } = setup();
    await expect(
      offers.openPhoto(stranger, 'c'.repeat(24), PHOTO_ID),
    ).rejects.toMatchObject({ status: 404, message: 'Offer not found' });
    await expect(
      offers.openPhoto(stranger, OFFER_ID, 'b'.repeat(24), 'thumbnail'),
    ).rejects.toMatchObject({ status: 404, message: 'Photo not found' });
    expect(photos.open).not.toHaveBeenCalled();
    expect(photoVariants.open).not.toHaveBeenCalled();
  });

  it('does not use the clock more than once and reads the offer with one query', async () => {
    const memory = memoryRepository([
      {
        animalId: ANIMAL_ID,
        ownerUserId: owner.userId,
        offers: [record({ id: OFFER_ID })],
      },
    ]);
    memory.photoRecords.set(ANIMAL_ID, [storedPhoto(PHOTO_ID)]);
    const now = vi.fn(() => NOW);
    await useCases(memory.repository, { now }).offers.openPhoto(
      stranger,
      OFFER_ID,
      PHOTO_ID,
    );
    expect(now).toHaveBeenCalledTimes(1);
    expect(memory.repository.findPhoto).toHaveBeenCalledTimes(1);
  });
});
