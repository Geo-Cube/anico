import type { AuthProvider, LoginErrorCode } from '@anico/shared-schemas';

export const providerNames: Record<AuthProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  apple: 'Apple',
};

export const loginErrorMessages: Record<LoginErrorCode, string> = {
  LOGIN_CANCELLED: 'Přihlášení bylo zrušeno. Můžeš to zkusit znovu.',
  LOGIN_EXPIRED:
    'Přihlašovací odkaz vypršel nebo už byl použitý. Začni přihlášení znovu.',
  LOGIN_FAILED: 'Přihlášení se nepodařilo. Zkus to prosím znovu.',
  ACCOUNT_DISABLED: 'Tento účet AniCo je zablokovaný. Obrať se na správce.',
  IDENTITY_ALREADY_LINKED:
    'Tento účet poskytovatele už patří jinému účtu AniCo. Účty se automaticky neslučují.',
  RECENT_LOGIN_REQUIRED:
    'Pro propojení se nejdřív odhlas a znovu přihlas ke svému stávajícímu účtu AniCo; propojení pak spusť do pěti minut.',
  PROVIDER_UNAVAILABLE:
    'Tento způsob přihlášení teď není dostupný. Zkus jiný nebo to zkus později.',
};
