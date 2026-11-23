import type {
  AuthProvider,
  Identity,
  LoginErrorCode,
  Role,
} from '@anico/shared-schemas';

export const displayName = (identity: Identity) =>
  [identity.givenName, identity.familyName].filter(Boolean).join(' ') ||
  identity.email ||
  'Uživatel AniCo';

export const roleName: Record<Role, string> = {
  breeder: 'Chovatel',
  admin: 'Administrátor',
  owner: 'Vlastník',
};

export const providerNames: Record<AuthProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  apple: 'Apple',
};

export const loginErrorMessages: Record<LoginErrorCode, string> = {
  LOGIN_CANCELLED: 'Přihlášení bylo zrušeno. Můžete to zkusit znovu.',
  LOGIN_EXPIRED:
    'Přihlašovací odkaz vypršel nebo už byl použitý. Začněte přihlášení znovu.',
  LOGIN_FAILED: 'Přihlášení se nepodařilo. Zkuste to prosím znovu.',
  ACCOUNT_DISABLED: 'Tento účet AniCo je zablokovaný. Obraťte se na správce.',
  IDENTITY_ALREADY_LINKED:
    'Tento účet poskytovatele už patří jinému účtu AniCo. Účty se automaticky neslučují.',
  RECENT_LOGIN_REQUIRED:
    'Pro propojení se nejdřív odhlaste a znovu přihlaste ke svému stávajícímu účtu AniCo; propojení pak spusťte do pěti minut.',
  PROVIDER_UNAVAILABLE:
    'Tento způsob přihlášení teď není dostupný. Zkuste jiný nebo to zkuste později.',
};
