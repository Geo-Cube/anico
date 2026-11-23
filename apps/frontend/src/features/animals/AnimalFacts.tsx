import type { Animal } from '@anico/shared-schemas';
import { cn } from '@/shared/lib/cn';
import { formatCalendarDate, formatWeightKg } from '@/shared/lib/format';
import { Card } from '@/shared/ui/card';
import { eyebrowClassName } from '@/shared/ui/page-header';
import { ageLabel, breedLabel, sexLabel, speciesLabel } from './api';
import { FIELD_LABEL, optionalFields, type OptionalField } from './fields';

/** Údaje společné pro zvíře vlastníka (`Animal`) i zvíře v nabídce (`OfferDetail['animal']`). */
export type AnimalFactsData = Pick<
  Animal,
  'species' | 'breedId' | 'sex' | OptionalField
>;

function displayValue(animal: AnimalFactsData, key: OptionalField) {
  if (key === 'birthDate')
    return animal.birthDate
      ? `${formatCalendarDate(animal.birthDate)} (${ageLabel(animal.birthDate)})`
      : null;
  if (key === 'weightKg')
    return animal.weightKg === null ? null : formatWeightKg(animal.weightKg);
  return animal[key];
}

/** Karta „Základní údaje“; nevyplněné údaje ukazuje jako „Nevyplněno“. */
export function AnimalFacts({ animal }: { animal: AnimalFactsData }) {
  const items = [
    { label: FIELD_LABEL.species!, value: speciesLabel(animal.species) },
    { label: FIELD_LABEL.breedId!, value: breedLabel(animal) },
    { label: FIELD_LABEL.sex!, value: sexLabel(animal.sex) },
    ...optionalFields.map(({ key, label }) => ({
      label,
      value: displayValue(animal, key),
      wide: key === 'description',
    })),
  ];
  return (
    <Card className="rounded-2xl p-6">
      <h2 className="mb-5 text-base font-semibold text-brand">
        Základní údaje
      </h2>
      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {items.map(({ label, value, ...item }) => (
          <div
            key={label}
            className={'wide' in item && item.wide ? 'sm:col-span-2' : ''}
          >
            <dt className={eyebrowClassName}>{label}</dt>
            <dd
              className={cn(
                'mt-1 text-sm break-words whitespace-pre-wrap',
                value === null && 'text-muted-foreground italic',
              )}
            >
              {value ?? 'Nevyplněno'}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
