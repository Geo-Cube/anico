import { describe, expect, it } from 'vitest';
import regionCatalog from '../catalogs/regions.json' with { type: 'json' };
import {
  CreateOfferSchema,
  InquiryUnavailableReasonSchema,
  MAX_OFFER_MESSAGE_LENGTH,
  MyOfferListSchema,
  OfferDetailSchema,
  OfferSchema,
  OfferStatusSchema,
  RegionIdSchema,
  regions,
} from '../src/index.js';

const animalId = 'a'.repeat(24);
const base = { animalId, regionId: 'praha' };
const offer = {
  id: 'b'.repeat(24),
  animalId,
  regionId: 'praha',
  validFrom: '2026-11-19T10:00:00.000Z',
  validTo: null,
  message: null,
  status: 'ACTIVE',
  canWithdraw: true,
  createdAt: '2026-11-19T10:00:00.000Z',
  withdrawnAt: null,
};

describe('UC04-VAL-2 katalog krajů a RegionIdSchema', () => {
  it('has 14 unique region ids in catalog order and the schema accepts exactly them', () => {
    const ids = regionCatalog.regions.map((region) => region.id);
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect(regions().map((region) => region.id)).toEqual(ids);
    for (const id of ids)
      expect(RegionIdSchema.safeParse(id).success).toBe(true);
    expect(RegionIdSchema.options).toEqual(ids);
  });

  it.each(['', 'Praha', 'praha ', 'moravia', 'PRAHA', 1, null])(
    'rejects unknown region %j',
    (regionId) => {
      expect(CreateOfferSchema.safeParse({ ...base, regionId }).success).toBe(
        false,
      );
    },
  );
});

describe('UC04-VAL-2 CreateOfferSchema', () => {
  it('accepts the minimal body: only animalId and regionId', () => {
    const parsed = CreateOfferSchema.parse(base);
    expect(parsed).toEqual(base);
    expect(parsed.validFrom).toBeUndefined();
    expect(parsed.validTo).toBeUndefined();
    expect(parsed.message).toBeUndefined();
  });

  it('rejects an animalId that is not 24 hex characters', () => {
    for (const bad of [
      '',
      'abc',
      'g'.repeat(24),
      'a'.repeat(23),
      'a'.repeat(25),
    ])
      expect(
        CreateOfferSchema.safeParse({ ...base, animalId: bad }).success,
      ).toBe(false);
    expect(CreateOfferSchema.safeParse({ regionId: 'praha' }).success).toBe(
      false,
    );
    expect(CreateOfferSchema.safeParse({ animalId }).success).toBe(false);
  });

  it('rejects unknown fields (strict object), including client-controlled identity and status', () => {
    for (const extra of [
      { ownerUserId: 'u1' },
      { status: 'ACTIVE' },
      { createdBy: 'u1' },
      { withdrawnAt: null },
      { foo: 1 },
    ]) {
      const result = CreateOfferSchema.safeParse({ ...base, ...extra });
      expect(result.success).toBe(false);
    }
  });

  describe('message', () => {
    it('trims the message', () => {
      expect(
        CreateOfferSchema.parse({ ...base, message: '  Ahoj světe \n' })
          .message,
      ).toBe('Ahoj světe');
    });

    it.each(['', '   ', '\n\t '])(
      'turns blank message %j into null',
      (message) => {
        expect(
          CreateOfferSchema.parse({ ...base, message }).message,
        ).toBeNull();
      },
    );

    it('keeps an explicit null message', () => {
      expect(
        CreateOfferSchema.parse({ ...base, message: null }).message,
      ).toBeNull();
    });

    it('accepts exactly the maximum length and rejects one more character', () => {
      expect(MAX_OFFER_MESSAGE_LENGTH).toBe(1000);
      expect(
        CreateOfferSchema.safeParse({ ...base, message: 'x'.repeat(1000) })
          .success,
      ).toBe(true);
      const tooLong = CreateOfferSchema.safeParse({
        ...base,
        message: 'x'.repeat(1001),
      });
      expect(tooLong.success).toBe(false);
      expect(tooLong.error?.issues[0]?.path).toEqual(['message']);
    });

    it('measures the limit after trimming', () => {
      const padded = `  ${'x'.repeat(1000)}  `;
      expect(
        CreateOfferSchema.parse({ ...base, message: padded }).message,
      ).toBe('x'.repeat(1000));
      expect(
        CreateOfferSchema.safeParse({
          ...base,
          message: `  ${'x'.repeat(1001)}  `,
        }).success,
      ).toBe(false);
    });

    it('rejects a non-string message', () => {
      expect(CreateOfferSchema.safeParse({ ...base, message: 5 }).success).toBe(
        false,
      );
    });
  });

  describe('validFrom and validTo', () => {
    it.each([
      '2026-11-19T10:00:00Z',
      '2026-11-19T10:00:00.123Z',
      '2026-11-19T10:00:00+01:00',
      '2026-11-19T10:00:00.5-05:30',
    ])('accepts ISO datetime with offset %s', (value) => {
      const parsed = CreateOfferSchema.parse({
        ...base,
        validFrom: value,
        validTo: value,
      });
      expect(parsed.validFrom).toBe(value);
      expect(parsed.validTo).toBe(value);
    });

    it.each([
      '2026-11-19',
      '2026-11-19T10:00:00',
      '19.11.2026 10:00',
      'tomorrow',
      '',
      '2026-13-40T10:00:00Z',
    ])('rejects datetime %j without a valid offset', (value) => {
      expect(
        CreateOfferSchema.safeParse({ ...base, validFrom: value }).success,
      ).toBe(false);
      expect(
        CreateOfferSchema.safeParse({ ...base, validTo: value }).success,
      ).toBe(false);
    });

    it('accepts the latest representable instant and rejects anything later after conversion to UTC', () => {
      for (const value of [
        '9999-12-31T23:59:59.999Z',
        '9999-12-31T23:59:59.999+00:00',
        '9999-12-31T23:59:59+01:00',
      ]) {
        expect(
          CreateOfferSchema.safeParse({
            ...base,
            validFrom: value,
            validTo: value,
          }).success,
          value,
        ).toBe(true);
      }
      for (const value of [
        '9999-12-31T23:00:00-05:00',
        '9999-12-31T23:59:59.999-00:01',
        '9999-12-31T23:59:59-01:00',
      ]) {
        for (const key of ['validFrom', 'validTo'] as const) {
          const result = CreateOfferSchema.safeParse({ ...base, [key]: value });
          expect(result.success, `${key} ${value}`).toBe(false);
          expect(result.error?.issues[0]?.path).toEqual([key]);
        }
      }
    });

    it('accepts validTo null (no end) and a missing validTo', () => {
      expect(
        CreateOfferSchema.parse({ ...base, validTo: null }).validTo,
      ).toBeNull();
      expect(CreateOfferSchema.parse(base).validTo).toBeUndefined();
    });

    it('does not accept null validFrom (start is either given or immediate)', () => {
      expect(
        CreateOfferSchema.safeParse({ ...base, validFrom: null }).success,
      ).toBe(false);
    });

    it('does not accept numeric timestamps', () => {
      expect(
        CreateOfferSchema.safeParse({ ...base, validFrom: Date.now() }).success,
      ).toBe(false);
    });
  });
});

describe('response schemas', () => {
  it('OfferSchema accepts a valid offer and exposes no audit fields', () => {
    expect(OfferSchema.parse(offer)).toEqual(offer);
    expect(OfferSchema.safeParse({ ...offer, createdBy: 'u1' }).success).toBe(
      false,
    );
    expect(OfferSchema.safeParse({ ...offer, withdrawnBy: 'u1' }).success).toBe(
      false,
    );
  });

  it('OfferStatusSchema is exactly the four statuses', () => {
    expect(OfferStatusSchema.options).toEqual([
      'SCHEDULED',
      'ACTIVE',
      'WITHDRAWN',
      'EXPIRED',
    ]);
  });

  it('MyOfferListSchema requires animal data and a null cursor', () => {
    const item = {
      ...offer,
      animal: { id: animalId, name: 'Luna', species: 'dog', breedId: 'x' },
    };
    expect(
      MyOfferListSchema.parse({ items: [item], nextCursor: null }),
    ).toEqual({ items: [item], nextCursor: null });
    expect(
      MyOfferListSchema.parse({ items: [], nextCursor: null }).items,
    ).toEqual([]);
    expect(
      MyOfferListSchema.safeParse({ items: [offer], nextCursor: null }).success,
    ).toBe(false);
    expect(
      MyOfferListSchema.safeParse({ items: [item], nextCursor: 'abc' }).success,
    ).toBe(false);
  });
});

describe('UC06-SEC-2 InquiryUnavailableReasonSchema', () => {
  it('is exactly the three reasons in priority order', () => {
    expect(InquiryUnavailableReasonSchema.options).toEqual([
      'OWN_OFFER',
      'NOT_ACTIVE',
      'INQUIRY_PENDING',
    ]);
  });

  it.each(['', 'own_offer', 'OWN OFFER', 'EXPIRED', null, 1])(
    'rejects %j',
    (reason) => {
      expect(InquiryUnavailableReasonSchema.safeParse(reason).success).toBe(
        false,
      );
    },
  );
});

describe('UC06-SEC-2 OfferDetailSchema', () => {
  const photoId = 'c'.repeat(24);
  const detail = {
    id: 'b'.repeat(24),
    animalId,
    regionId: 'praha',
    validFrom: '2026-11-19T10:00:00.000Z',
    validTo: null,
    message: null,
    status: 'ACTIVE',
    animal: {
      name: 'Luna',
      species: 'dog',
      breedId: 'aljassky-malamut',
      sex: 'female',
      birthDate: '2022-03-01',
      coatColor: 'šedá',
      weightKg: 24.5,
      city: 'Brno',
      pedigreeNumber: 'CMKU/123',
      microchipNumber: '  000123  ',
      description: 'Klidná fena',
      photos: [
        { id: photoId, isPrimary: true },
        { id: 'd'.repeat(24), isPrimary: false },
      ],
    },
    verification: { verified: true, documentTypes: ['PEDIGREE'] },
    canSendInquiry: true,
    inquiryUnavailableReason: null,
  };
  const withAnimal = (patch: object) => ({
    ...detail,
    animal: { ...detail.animal, ...patch },
  });
  const parses = (value: unknown) => OfferDetailSchema.safeParse(value).success;

  it('accepts a complete detail and returns it unchanged', () => {
    expect(OfferDetailSchema.parse(detail)).toEqual(detail);
  });

  it('accepts nulls in every optional animal field, no photos and no verification', () => {
    const minimal = {
      ...detail,
      validTo: null,
      message: null,
      animal: {
        ...detail.animal,
        birthDate: null,
        coatColor: null,
        weightKg: null,
        city: null,
        pedigreeNumber: null,
        microchipNumber: null,
        description: null,
        photos: [],
      },
      verification: { verified: false, documentTypes: [] },
    };
    expect(OfferDetailSchema.parse(minimal)).toEqual(minimal);
  });

  it('accepts validTo as an ISO instant and every offer status', () => {
    expect(parses({ ...detail, validTo: '2026-12-01T00:00:00.000Z' })).toBe(
      true,
    );
    for (const status of OfferStatusSchema.options)
      expect(parses({ ...detail, status })).toBe(true);
  });

  it.each([
    ['top level', (d: typeof detail) => ({ ...d, ownerUserId: 'u1' })],
    [
      'top level createdAt',
      (d: typeof detail) => ({ ...d, createdAt: d.validFrom }),
    ],
    ['top level inquiries', (d: typeof detail) => ({ ...d, inquiries: [] })],
    [
      'animal',
      (d: typeof detail) => ({
        ...d,
        animal: { ...d.animal, ownerUserId: 'u1' },
      }),
    ],
    [
      'animal documents',
      (d: typeof detail) => ({ ...d, animal: { ...d.animal, documents: [] } }),
    ],
    [
      'photo fileName',
      (d: typeof detail) => ({
        ...d,
        animal: {
          ...d.animal,
          photos: [{ id: photoId, isPrimary: true, fileName: 'a.png' }],
        },
      }),
    ],
    [
      'photo url',
      (d: typeof detail) => ({
        ...d,
        animal: {
          ...d.animal,
          photos: [{ id: photoId, isPrimary: true, url: '/x' }],
        },
      }),
    ],
    [
      'verification',
      (d: typeof detail) => ({
        ...d,
        verification: { ...d.verification, reviewedBy: 'u1' },
      }),
    ],
  ])('rejects an unknown field in %s (strict)', (_where, mutate) => {
    expect(parses(detail)).toBe(true);
    expect(parses(mutate(detail))).toBe(false);
  });

  it.each([
    'id',
    'animalId',
    'regionId',
    'validFrom',
    'validTo',
    'message',
    'status',
    'animal',
    'verification',
    'canSendInquiry',
    'inquiryUnavailableReason',
  ])('requires %s', (key) => {
    const { [key]: _omitted, ...rest } = detail as Record<string, unknown>;
    expect(parses(rest)).toBe(false);
  });

  it.each([
    'name',
    'species',
    'breedId',
    'sex',
    'birthDate',
    'coatColor',
    'weightKg',
    'city',
    'pedigreeNumber',
    'microchipNumber',
    'description',
    'photos',
  ])('requires animal.%s (nullable fields are present, not omitted)', (key) => {
    const { [key]: _omitted, ...animal } = detail.animal as Record<
      string,
      unknown
    >;
    expect(parses({ ...detail, animal })).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(parses({ ...detail, id: 'xyz' })).toBe(false);
    expect(parses({ ...detail, animalId: 'xyz' })).toBe(false);
    expect(parses({ ...detail, regionId: 'moravia' })).toBe(false);
    expect(parses({ ...detail, status: 'DRAFT' })).toBe(false);
    expect(parses({ ...detail, validFrom: '2026-11-19' })).toBe(false);
    expect(parses({ ...detail, validTo: 'soon' })).toBe(false);
    expect(parses(withAnimal({ species: 'cat' }))).toBe(false);
    expect(parses(withAnimal({ sex: 'unknown' }))).toBe(false);
    expect(parses(withAnimal({ name: '' }))).toBe(false);
    expect(parses(withAnimal({ weightKg: 0 }))).toBe(false);
    expect(parses(withAnimal({ birthDate: '01.03.2022' }))).toBe(false);
    expect(
      parses(withAnimal({ photos: [{ id: 'nope', isPrimary: true }] })),
    ).toBe(false);
    expect(parses(withAnimal({ photos: [{ id: photoId }] }))).toBe(false);
    expect(
      parses({
        ...detail,
        verification: { verified: true, documentTypes: ['PASSPORT'] },
      }),
    ).toBe(false);
  });

  it('rejects canSendInquiry that contradicts inquiryUnavailableReason', () => {
    expect(
      parses({
        ...detail,
        canSendInquiry: false,
        inquiryUnavailableReason: null,
      }),
    ).toBe(false);
    for (const reason of InquiryUnavailableReasonSchema.options) {
      expect(
        parses({
          ...detail,
          canSendInquiry: true,
          inquiryUnavailableReason: reason,
        }),
      ).toBe(false);
      expect(
        parses({
          ...detail,
          canSendInquiry: false,
          inquiryUnavailableReason: reason,
        }),
      ).toBe(true);
    }
  });

  it('rejects verified that contradicts documentTypes', () => {
    expect(
      parses({
        ...detail,
        verification: { verified: false, documentTypes: ['PEDIGREE'] },
      }),
    ).toBe(false);
    expect(
      parses({
        ...detail,
        verification: { verified: true, documentTypes: [] },
      }),
    ).toBe(false);
    expect(
      parses({
        ...detail,
        verification: { verified: false, documentTypes: [] },
      }),
    ).toBe(true);
  });
});
