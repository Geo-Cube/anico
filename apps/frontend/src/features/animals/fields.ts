/** Volitelné údaje profilu v pořadí formuláře i detailu (UC-02/1). */
export const optionalFields = [
  { key: 'birthDate', label: 'Datum narození' },
  { key: 'weightKg', label: 'Hmotnost' },
  { key: 'coatColor', label: 'Barva srsti', max: 60 },
  { key: 'city', label: 'Obec', max: 120 },
  { key: 'pedigreeNumber', label: 'Číslo průkazu původu', max: 60 },
  { key: 'microchipNumber', label: 'Číslo mikročipu', max: 64 },
  { key: 'description', label: 'Popis', max: 2000 },
] as const;
export type OptionalField = (typeof optionalFields)[number]['key'];

const photoLabel = 'Fotografie';
/** Popisky polí pro chyby ze serveru (`issues[].path[0]`). */
export const FIELD_LABEL: Record<string, string> = {
  name: 'Jméno',
  species: 'Druh',
  breedId: 'Plemeno',
  sex: 'Pohlaví',
  ...Object.fromEntries(optionalFields.map(({ key, label }) => [key, label])),
  removePhotoIds: photoLabel,
  primaryPhotoId: photoLabel,
  primaryUploadIndex: photoLabel,
  photos: photoLabel,
};
