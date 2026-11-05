import { useEffect, useState, type FormEvent } from 'react';
import {
  CreateAnimalSchema,
  UpdateAnimalSchema,
  type Animal,
  type AnimalSpecies,
  type AnimalSex,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { AnimalError } from './AnimalError';
import {
  animalKey,
  animalQuery,
  breedsQuery,
  photoUrl,
  saveAnimal,
} from './api';

export const optionalFields = [
  { key: 'name', label: 'Jméno', max: 120 },
  { key: 'birthDate', label: 'Datum narození', type: 'date' },
  { key: 'coatColor', label: 'Barva srsti', max: 60 },
  { key: 'weightKg', label: 'Hmotnost (kg)', type: 'number' },
  { key: 'city', label: 'Město', max: 120 },
  { key: 'pedigreeNumber', label: 'Číslo průkazu původu', max: 60 },
  { key: 'microchipNumber', label: 'Číslo mikročipu', max: 64 },
  { key: 'description', label: 'Popis', max: 2000 },
] as const;
const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <img
      src={url}
      alt={file.name}
      className="h-32 w-full rounded-lg object-cover"
    />
  );
}

export function AnimalFormPage() {
  const { animalId } = useParams();
  const query = useQuery({
    ...animalQuery(animalId ?? ''),
    enabled: Boolean(animalId),
  });
  if (!animalId) return <AnimalForm />;
  if (query.isPending) return <p role="status">Načítám zvíře…</p>;
  if (query.isError)
    return (
      <AnimalError error={query.error} onRetry={() => void query.refetch()} />
    );
  return <AnimalForm key={query.data.id} animal={query.data} />;
}

function AnimalForm({ animal }: { animal?: Animal }) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [initialAnimal] = useState(animal);
  const [species, setSpecies] = useState<AnimalSpecies>(
    animal?.species ?? 'dog',
  );
  const [breedId, setBreedId] = useState(animal?.breedId ?? '');
  const [sex, setSex] = useState<AnimalSex>(animal?.sex ?? 'male');
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      optionalFields.map(({ key }) => [key, String(animal?.[key] ?? '')]),
    ),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [primary, setPrimary] = useState(
    animal?.photos.find((photo) => photo.isPrimary)?.id ?? '',
  );
  const [validation, setValidation] = useState<string[]>([]);
  const breeds = useQuery(breedsQuery(species));
  const existing =
    animal?.photos.filter((photo) => !removed.includes(photo.id)) ?? [];
  const mutation = useMutation({
    mutationFn: async (input: Parameters<typeof saveAnimal>[0]) => {
      // Generace relace v okamžiku odeslání: odpověď pro jiný účet se zahodí.
      const generation = sessionGeneration(client);
      return {
        generation,
        saved: await saveAnimal(input, files, session.csrfToken, animal?.id),
      };
    },
    onSuccess: async ({ generation, saved }) => {
      const current = () => generation === sessionGeneration(client);
      if (!current()) return;
      await client.invalidateQueries({ queryKey: animalKey });
      if (!current()) return;
      client.setQueryData([...animalKey, saved.id], saved);
      void navigate(`/zvirata/${saved.id}`);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = {
      species,
      breedId,
      sex,
      ...Object.fromEntries(
        optionalFields.map(({ key }) => [
          key,
          values[key]?.trim()
            ? key === 'weightKg'
              ? Number(values[key])
              : values[key]
            : null,
        ]),
      ),
    };
    const primaryChoice = primary.startsWith('new:')
      ? { primaryUploadIndex: Number(primary.slice(4)) }
      : primary &&
          primary !==
            initialAnimal?.photos.find((photo) => photo.isPrimary)?.id &&
          existing.some((photo) => photo.id === primary)
        ? { primaryPhotoId: primary }
        : {};
    const changes = initialAnimal
      ? {
          ...(species !== initialAnimal.species ||
          breedId !== initialAnimal.breedId
            ? { species, breedId }
            : {}),
          ...(sex !== initialAnimal.sex ? { sex } : {}),
          ...Object.fromEntries(
            optionalFields
              .filter(
                ({ key }) => values[key] !== String(initialAnimal[key] ?? ''),
              )
              .map(({ key }) => [
                key,
                values[key]?.trim()
                  ? key === 'weightKg'
                    ? Number(values[key])
                    : values[key]
                  : null,
              ]),
          ),
          ...(removed.length ? { removePhotoIds: removed } : {}),
          ...primaryChoice,
        }
      : {};
    if (
      initialAnimal &&
      Object.keys(changes).length === 0 &&
      files.length === 0
    ) {
      void navigate(`/zvirata/${initialAnimal.id}`);
      return;
    }
    const result = animal
      ? UpdateAnimalSchema.safeParse(changes)
      : CreateAnimalSchema.safeParse({
          ...profile,
          ...(primary.startsWith('new:') ? primaryChoice : {}),
        });
    if (!result.success) {
      setValidation(
        result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      );
      return;
    }
    if (existing.length + files.length > 10) {
      setValidation(['Zvíře může mít nejvýše 10 fotografií.']);
      return;
    }
    if (files.some((file) => file.size > 10 * 1024 * 1024)) {
      setValidation(['Každá fotografie může mít nejvýše 10 MiB.']);
      return;
    }
    if (
      files.some((file) => !['image/jpeg', 'image/png'].includes(file.type))
    ) {
      setValidation(['Fotografie musí být ve formátu JPEG nebo PNG.']);
      return;
    }
    setValidation([]);
    mutation.mutate(result.data);
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <Link
        className="text-sm underline"
        to={animal ? `/zvirata/${animal.id}` : '/zvirata'}
      >
        Zpět
      </Link>
      <h1 className="text-2xl font-semibold text-brand">
        {animal ? 'Upravit zvíře' : 'Přidat zvíře'}
      </h1>
      <form onSubmit={submit} className="space-y-6">
        <fieldset disabled={mutation.isPending} className="space-y-6">
          <legend className="sr-only">Profil zvířete</legend>
          <Card className="grid gap-4 p-6 sm:grid-cols-2">
            <label className="space-y-1">
              Druh
              <select
                className={inputClass}
                value={species}
                onChange={(event) => {
                  setSpecies(event.target.value as AnimalSpecies);
                  setBreedId('');
                }}
              >
                <option value="dog">Pes</option>
                <option value="horse">Kůň</option>
              </select>
            </label>
            <label className="space-y-1">
              Plemeno
              <select
                required
                className={inputClass}
                value={breedId}
                disabled={!breeds.data}
                onChange={(event) => setBreedId(event.target.value)}
              >
                <option value="">
                  {breeds.isPending ? 'Načítám plemena…' : 'Vyber plemeno'}
                </option>
                {breeds.data?.breeds.map((breed) => (
                  <option key={breed.id} value={breed.id}>
                    {breed.name}
                  </option>
                ))}
              </select>
            </label>
            {breeds.isError && (
              <AnimalError
                error={breeds.error}
                onRetry={() => void breeds.refetch()}
              />
            )}
            <label className="space-y-1">
              Pohlaví
              <select
                className={inputClass}
                value={sex}
                onChange={(event) => setSex(event.target.value as AnimalSex)}
              >
                <option value="male">Samec</option>
                <option value="female">Samice</option>
              </select>
            </label>
            {optionalFields.map((field) => (
              <label key={field.key} className="space-y-1">
                {field.label}
                {field.key === 'description' ? (
                  <textarea
                    className={inputClass}
                    maxLength={field.max}
                    value={values[field.key]}
                    onChange={(event) =>
                      setValues({ ...values, [field.key]: event.target.value })
                    }
                  />
                ) : (
                  <input
                    className={inputClass}
                    type={'type' in field ? field.type : 'text'}
                    maxLength={'max' in field ? field.max : undefined}
                    {...(field.key === 'weightKg'
                      ? { min: 0.01, max: 2000, step: 'any' }
                      : {})}
                    {...(field.key === 'birthDate'
                      ? { max: new Date().toISOString().slice(0, 10) }
                      : {})}
                    value={values[field.key]}
                    onChange={(event) =>
                      setValues({ ...values, [field.key]: event.target.value })
                    }
                  />
                )}
              </label>
            ))}
          </Card>
          <Card className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">Fotografie</h2>
            <p className="text-sm text-muted-foreground">
              JPEG nebo PNG, nejvýše 10 MiB na soubor a 10 fotografií. Vyber
              hlavní fotografii; jinak se použije první zachovaná nebo nová.
            </p>
            <label className="block">
              Přidat fotografie
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png"
                className="mt-2 block w-full"
                onChange={(event) => {
                  const added = Array.from(event.target.files ?? []);
                  setFiles((current) => [...current, ...added]);
                  event.target.value = '';
                }}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              {existing.map((photo) => (
                <div key={photo.id} className="space-y-2">
                  <img
                    src={photoUrl(animal!.id, photo.id)}
                    alt={photo.fileName}
                    className="h-32 w-full rounded-lg object-cover"
                  />
                  <label className="flex gap-2">
                    <input
                      type="radio"
                      name="primary"
                      checked={primary === photo.id}
                      onChange={() => setPrimary(photo.id)}
                    />
                    Hlavní: {photo.fileName}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRemoved([...removed, photo.id]);
                      if (primary === photo.id) setPrimary('');
                    }}
                  >
                    Odebrat {photo.fileName}
                  </Button>
                </div>
              ))}
              {files.map((file, index) => (
                <div key={index} className="space-y-2">
                  <UploadPreview file={file} />
                  <label className="flex gap-2">
                    <input
                      type="radio"
                      name="primary"
                      checked={primary === `new:${index}`}
                      onChange={() => setPrimary(`new:${index}`)}
                    />
                    Hlavní: {file.name}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setFiles(
                        files.filter((_, position) => position !== index),
                      );
                      if (primary.startsWith('new:')) {
                        const selected = Number(primary.slice(4));
                        setPrimary(
                          selected === index
                            ? ''
                            : `new:${selected > index ? selected - 1 : selected}`,
                        );
                      }
                    }}
                  >
                    Odebrat {file.name}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
          {validation.length > 0 && (
            <Alert variant="error">
              <ul>
                {validation.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {mutation.isError && <AnimalError error={mutation.error} />}
          <Button type="submit" disabled={mutation.isPending || !breeds.data}>
            {mutation.isPending ? 'Ukládám…' : 'Uložit zvíře'}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}
