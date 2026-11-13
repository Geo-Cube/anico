import { describe, expect, it } from 'vitest';
import {
  BreederVerifiedEventSchema,
  DecideAnimalDocumentSchema,
  DecideVerificationRequestSchema,
  MAX_DOCUMENTS_PER_SUBMISSION,
  SubmitAnimalDocumentsSchema,
  SubmitVerificationRequestSchema,
  UpdateMyProfileSchema,
  UserRegisteredEventSchema,
} from '../src/index.js';

const uuid = '3f1c5b8e-2f6a-4d3b-9c1e-7a8b9c0d1e2f';

describe('BreederVerifiedEventSchema', () => {
  const event = {
    eventId: uuid,
    type: 'breeder.verified',
    schemaVersion: 1,
    producer: 'breeder-service',
    occurredAt: '2026-11-13T10:00:00Z',
    data: { breederId: uuid, verifiedAt: '2026-11-13T10:00:00Z' },
  };

  it('přijme událost verze 1 od breeder-service', () => {
    expect(BreederVerifiedEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ['jiná verze', { schemaVersion: 2 }],
    ['jiný producent', { producer: 'animal-service' }],
    ['jiný typ', { type: 'breeder.rejected' }],
    ['neplatné eventId', { eventId: 'x' }],
    ['neplatný čas', { occurredAt: '13.11.2026' }],
    ['pole navíc', { isVerified: true }],
    ['data navíc', { data: { ...event.data, reviewedBy: uuid } }],
  ])('odmítne %s', (_, override) => {
    expect(
      BreederVerifiedEventSchema.safeParse({ ...event, ...override }).success,
    ).toBe(false);
  });
});

describe('UserRegisteredEventSchema', () => {
  it('nepřenáší role ani identifikátory poskytovatele', () => {
    const event = {
      eventId: uuid,
      type: 'user.registered',
      schemaVersion: 1,
      producer: 'auth-service',
      occurredAt: '2026-11-13T10:00:00Z',
      data: { userId: uuid, givenName: 'Jan', familyName: null, email: null },
    };
    expect(UserRegisteredEventSchema.safeParse(event).success).toBe(true);
    expect(
      UserRegisteredEventSchema.safeParse({
        ...event,
        data: { ...event.data, roles: ['admin'] },
      }).success,
    ).toBe(false);
  });
});

describe('DecideVerificationRequestSchema', () => {
  it('schválení nevyžaduje důvod, ale vyžaduje revizi', () => {
    expect(
      DecideVerificationRequestSchema.safeParse({
        decision: 'APPROVED',
        revision: 1,
      }).success,
    ).toBe(true);
    expect(
      DecideVerificationRequestSchema.safeParse({ decision: 'APPROVED' })
        .success,
    ).toBe(false);
    expect(
      DecideVerificationRequestSchema.safeParse({
        decision: 'APPROVED',
        revision: 0,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['REJECTED', 'rejectionReason'],
    ['RETURNED', 'returnReason'],
  ])('%s vyžaduje neprázdný %s do 500 znaků', (decision, field) => {
    const decide = (value?: string) =>
      DecideVerificationRequestSchema.safeParse({
        decision,
        revision: 2,
        ...(value === undefined ? {} : { [field]: value }),
      });
    expect(decide().success).toBe(false);
    expect(decide('   ').success).toBe(false);
    expect(decide('x'.repeat(501)).success).toBe(false);
    expect(decide(' Chybí razítko ').data).toEqual({
      decision,
      revision: 2,
      [field]: 'Chybí razítko',
    });
  });

  it('odmítne důvod nepatřící k rozhodnutí a reviewed_by z těla', () => {
    expect(
      DecideVerificationRequestSchema.safeParse({
        decision: 'APPROVED',
        revision: 1,
        rejectionReason: 'x',
      }).success,
    ).toBe(false);
    expect(
      DecideVerificationRequestSchema.safeParse({
        decision: 'REJECTED',
        revision: 1,
        returnReason: 'x',
      }).success,
    ).toBe(false);
    expect(
      DecideVerificationRequestSchema.safeParse({
        decision: 'APPROVED',
        revision: 1,
        reviewed_by: uuid,
      }).success,
    ).toBe(false);
  });
});

describe('SubmitVerificationRequestSchema', () => {
  const input = {
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.test',
    breedingStationName: 'Od Potoka',
    breedingStationNumber: 'CZ-123',
  };

  it.each(['breeder_id', 'is_verified', 'reviewed_by', 'isVerified', 'status'])(
    'odmítne pole %s z těla požadavku',
    (field) => {
      expect(
        SubmitVerificationRequestSchema.safeParse({ ...input, [field]: true })
          .success,
      ).toBe(false);
    },
  );

  it('odmítne údaje složené jen z mezer', () => {
    expect(
      SubmitVerificationRequestSchema.safeParse({
        ...input,
        breedingStationName: ' ',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateMyProfileSchema', () => {
  it('vyžaduje alespoň jeden údaj a odmítne neznámá pole', () => {
    expect(UpdateMyProfileSchema.safeParse({}).success).toBe(false);
    expect(UpdateMyProfileSchema.parse({ firstName: ' Jan ' })).toEqual({
      firstName: 'Jan',
    });
    expect(
      UpdateMyProfileSchema.safeParse({ firstName: 'Jan', isVerified: true })
        .success,
    ).toBe(false);
    expect(
      UpdateMyProfileSchema.safeParse({ breedingStationName: 'X' }).success,
    ).toBe(false);
  });
});

describe('SubmitAnimalDocumentsSchema', () => {
  it('jediný typ z multipart převede na pole', () => {
    expect(
      SubmitAnimalDocumentsSchema.parse({ documentTypes: 'PEDIGREE' }),
    ).toEqual({
      documentTypes: ['PEDIGREE'],
    });
  });

  it('dodrží limit dokladů v jednom podání', () => {
    const types = (n: number) =>
      Array.from({ length: n }, () => 'HEALTH_RESULTS');
    expect(
      SubmitAnimalDocumentsSchema.safeParse({
        documentTypes: types(MAX_DOCUMENTS_PER_SUBMISSION),
      }).success,
    ).toBe(true);
    expect(
      SubmitAnimalDocumentsSchema.safeParse({
        documentTypes: types(MAX_DOCUMENTS_PER_SUBMISSION + 1),
      }).success,
    ).toBe(false);
    expect(
      SubmitAnimalDocumentsSchema.safeParse({ documentTypes: [] }).success,
    ).toBe(false);
    expect(
      SubmitAnimalDocumentsSchema.safeParse({ documentTypes: ['PASSPORT'] })
        .success,
    ).toBe(false);
  });
});

describe('DecideAnimalDocumentSchema', () => {
  it('zamítnutí vyžaduje důvod, schválení důvod nepřijme', () => {
    expect(
      DecideAnimalDocumentSchema.safeParse({ decision: 'REJECTED' }).success,
    ).toBe(false);
    expect(
      DecideAnimalDocumentSchema.safeParse({
        decision: 'REJECTED',
        rejectionReason: ' ',
      }).success,
    ).toBe(false);
    expect(
      DecideAnimalDocumentSchema.parse({
        decision: 'REJECTED',
        rejectionReason: ' Rozmazané ',
      }),
    ).toEqual({ decision: 'REJECTED', rejectionReason: 'Rozmazané' });
    expect(
      DecideAnimalDocumentSchema.safeParse({
        decision: 'APPROVED',
        rejectionReason: 'x',
      }).success,
    ).toBe(false);
  });
});
