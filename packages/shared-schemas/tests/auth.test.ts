import { describe, expect, it } from 'vitest';
import {
  CreateTestAccountSchema,
  IdentitySchema,
  SafeReturnPathSchema,
  isSafeReturnPath,
} from '../src/index.js';

describe('isSafeReturnPath', () => {
  it.each([
    '/',
    '/zvirata',
    '/zvirata/507f1f77bcf86cd799439011/doklady',
    '/administrace/chovatele?status=PENDING&x=%20a',
    '/apiary',
    '/a'.repeat(80),
  ])('přijme interní cestu %s', (value) => {
    expect(isSafeReturnPath(value)).toBe(true);
    expect(SafeReturnPathSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['protokol-relativní URL', '//evil.example'],
    ['zpětné lomítko', '/\\evil.example'],
    ['zpětné lomítko na začátku', '\\\\evil.example'],
    ['absolutní URL', 'https://evil.example/'],
    ['javascript schéma', 'javascript:alert(1)'],
    ['relativní cesta', 'zvirata'],
    ['prázdná hodnota', ''],
    ['dvojité lomítko uprostřed', '/a//evil.example'],
    ['tečkový segment', '/zvirata/../api'],
    ['jedna tečka', '/./x'],
    ['kódované lomítko v cestě', '/%2F%2Fevil.example'],
    ['kódované zpětné lomítko', '/%5Cevil.example'],
    ['API cesta', '/api/auth/logout'],
    ['API cesta jinou velikostí', '/API'],
    ['fragment', '/zvirata#x'],
    ['řídicí znak CR/LF', '/zvirata\r\nLocation: //evil'],
    ['tabulátor', '/\t/evil.example'],
    ['NUL', '/a\u0000'],
    ['ne-ASCII', '/zvířata'],
    ['mezera', '/a b'],
    ['neplatné escape v query', '/a?x=%zz'],
    ['useknutý escape v query', '/a?x=%2'],
    ['zpětné lomítko v query', '/a?next=\\evil'],
    ['delší než 160 znaků', '/' + 'a'.repeat(160)],
  ])('odmítne %s', (_, value) => {
    expect(isSafeReturnPath(value)).toBe(false);
    expect(SafeReturnPathSchema.safeParse(value).success).toBe(false);
  });

  it('hranice délky je 160 znaků', () => {
    expect(isSafeReturnPath('/' + 'a'.repeat(159))).toBe(true);
  });
});

describe('IdentitySchema', () => {
  const identity = {
    userId: '3f1c5b8e-2f6a-4d3b-9c1e-7a8b9c0d1e2f',
    givenName: null,
    familyName: null,
    email: null,
    roles: ['breeder'],
  };

  it.each(['is_verified', 'isVerified', 'breeder_id', 'reviewed_by'])(
    'odmítne pole %s navíc',
    (field) => {
      expect(
        IdentitySchema.safeParse({ ...identity, [field]: true }).success,
      ).toBe(false);
    },
  );

  it.each([[[]], [['breeder', 'breeder']], [['root']]])(
    'odmítne role %j',
    (roles) => {
      expect(IdentitySchema.safeParse({ ...identity, roles }).success).toBe(
        false,
      );
    },
  );
});

describe('CreateTestAccountSchema', () => {
  it('ořízne jména, odmítne jméno z mezer a neznámé pole roles', () => {
    expect(
      CreateTestAccountSchema.parse({
        givenName: ' Jan ',
        familyName: 'Novák',
      }),
    ).toEqual({ givenName: 'Jan', familyName: 'Novák' });
    expect(
      CreateTestAccountSchema.safeParse({ givenName: '  ', familyName: 'N' })
        .success,
    ).toBe(false);
    expect(
      CreateTestAccountSchema.safeParse({
        givenName: 'J',
        familyName: 'N',
        roles: ['owner'],
      }).success,
    ).toBe(false);
  });
});
