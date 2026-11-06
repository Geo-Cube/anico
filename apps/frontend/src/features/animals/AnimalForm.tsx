import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  CreateAnimalSchema,
  MAX_PHOTOS_PER_ANIMAL,
  UpdateAnimalSchema,
  todayInCzechia,
  type Animal,
  type AnimalSex,
  type AnimalSpecies,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ImagePlus, Star, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName, Field } from '@/shared/ui/field';
import { PageHeader } from '@/shared/ui/page-header';
import { AnimalError } from './AnimalError';
import {
  animalKey,
  animalQuery,
  breedsQuery,
  photoUrl,
  saveAnimal,
} from './api';
import { optionalFields, type OptionalField } from './fields';
import type { ResultState } from './ResultMessage';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

type Step = 'profile' | 'photos';
type ProfileField = 'name' | 'breedId' | OptionalField;
type Errors = Partial<Record<ProfileField, string>>;
type Values = Record<OptionalField, string>;

/** Dnešek podle českého kalendáře, stejně jako sdílené schéma (formulář i API rozhodnou stejně). */
const today = todayInCzechia;

/** Hmotnost s desetinnou čárkou i tečkou; prázdná je `null`. */
const parseWeight = (value: string) => Number(value.trim().replace(',', '.'));

function initialValue(animal: Animal | undefined, key: OptionalField) {
  const value = animal?.[key];
  if (value === null || value === undefined) return '';
  return key === 'weightKg' ? String(value).replace('.', ',') : String(value);
}

function toPayload(key: OptionalField, value: string) {
  if (!value.trim()) return null;
  return key === 'weightKg' ? parseWeight(value) : value;
}

/** Pravidla UC-02/1 s českými zprávami u polí; server je kontroluje znovu. */
function validateProfile(name: string, breedId: string, values: Values) {
  const errors: Errors = {};
  if (!name.trim()) errors.name = 'Vyplňte jméno zvířete.';
  if (!breedId) errors.breedId = 'Vyberte plemeno.';
  const birthDate = values.birthDate.trim();
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate))
    errors.birthDate = 'Zadejte platné datum.';
  else if (birthDate > today())
    errors.birthDate = 'Datum narození nesmí být v budoucnosti.';
  if (values.weightKg.trim()) {
    const weight = parseWeight(values.weightKg);
    if (!Number.isFinite(weight))
      errors.weightKg = 'Zadejte hmotnost číslem, například 12,5.';
    else if (weight <= 0) errors.weightKg = 'Hmotnost musí být větší než 0 kg.';
    else if (weight > 2000)
      errors.weightKg = 'Hmotnost může být nejvýše 2000 kg.';
  }
  return errors;
}

function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <img src={url} alt="" className="size-full object-cover" />;
}

function PhotoTile({
  name,
  primary,
  preview,
  onPrimary,
  onRemove,
}: {
  name: string;
  primary: boolean;
  preview: ReactNode;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        'relative overflow-hidden rounded-xl border-2 bg-card transition',
        primary ? 'border-primary' : 'border-border',
      )}
    >
      <div className="aspect-[4/3] bg-muted">{preview}</div>
      {primary && (
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          <Star className="size-3 fill-current" aria-hidden />
          Hlavní
        </span>
      )}
      <button
        type="button"
        aria-label={`Odebrat ${name}`}
        onClick={onRemove}
        className="absolute top-2 right-2 rounded-full bg-card/90 p-1.5 text-foreground shadow-sm transition hover:bg-destructive-soft hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
        <input
          type="radio"
          name="primary-photo"
          aria-label={`Hlavní fotografie: ${name}`}
          checked={primary}
          onChange={onPrimary}
          className="accent-primary"
        />
        <span className="truncate" title={name}>
          {name}
        </span>
      </label>
    </li>
  );
}

function Stepper({
  step,
  onStep,
}: {
  step: Step;
  onStep: (next: Step) => void;
}) {
  const steps = [
    { id: 'profile', label: 'Údaje' },
    { id: 'photos', label: 'Fotografie' },
  ] as const;
  return (
    <ol className="flex items-center gap-3 text-sm">
      {steps.map((item, index) => {
        const current = item.id === step;
        const done = step === 'photos' && item.id === 'profile';
        return (
          <li key={item.id} className="flex items-center gap-3">
            {index > 0 && <span className="h-px w-8 bg-border" aria-hidden />}
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              onClick={() => onStep(item.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-1 py-0.5 font-medium transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                current
                  ? 'text-brand'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs',
                  current
                    ? 'bg-primary text-primary-foreground'
                    : done
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              {item.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function AnimalFormPage() {
  const { animalId } = useParams();
  const query = useQuery({
    ...animalQuery(animalId ?? ''),
    enabled: Boolean(animalId),
  });
  if (!animalId) return <AnimalForm />;
  if (query.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Načítám zvíře…
      </p>
    );
  if (query.isError)
    return (
      <AnimalError error={query.error} onRetry={() => void query.refetch()} />
    );
  return <AnimalForm key={query.data.id} animal={query.data} />;
}

/**
 * WF 02/03 přidání a WF 05/06 úprava: údaje a fotografie ve dvou krocích, uložené jedním
 * požadavkem (ADR-0006). Zrušení ani přechod mezi kroky nic neukládá.
 */
function AnimalForm({ animal }: { animal?: Animal }) {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [initialAnimal] = useState(animal);
  const [step, setStep] = useState<Step>('profile');
  const [species, setSpecies] = useState<AnimalSpecies>(
    animal?.species ?? 'dog',
  );
  const [breedId, setBreedId] = useState(animal?.breedId ?? '');
  const [sex, setSex] = useState<AnimalSex>(animal?.sex ?? 'male');
  const [name, setName] = useState(animal?.name ?? '');
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        optionalFields.map(({ key }) => [key, initialValue(animal, key)]),
      ) as Values,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [primary, setPrimary] = useState(
    animal?.photos.find((photo) => photo.isPrimary)?.id ?? '',
  );
  const [photoProblems, setPhotoProblems] = useState<string[]>([]);
  const [formProblem, setFormProblem] = useState<string>();
  const breeds = useQuery(breedsQuery(species));
  const existing =
    animal?.photos.filter((photo) => !removed.includes(photo.id)) ?? [];
  const tiles = [
    ...existing.map((photo) => photo.id),
    ...files.map((_, index) => `new:${index}`),
  ];
  // Bez výslovné volby je hlavní ta, kterou zvolí i server: dosavadní, jinak první.
  const effectivePrimary = tiles.includes(primary) ? primary : (tiles[0] ?? '');
  const leaveTo = animal ? `/zvirata/${animal.id}` : '/zvirata';

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
      void navigate(`/zvirata/${saved.id}`, {
        state: {
          result: animal
            ? `Změny zvířete ${saved.name} byly uloženy.`
            : `Zvíře ${saved.name} bylo přidáno.`,
        } satisfies ResultState,
      });
    },
  });

  function goTo(next: Step) {
    setStep(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  /** Zkontroluje údaje; při chybě otevře krok údajů a zaměří první chybné pole. */
  function checkProfile() {
    const found = validateProfile(name, breedId, values);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return true;
    setStep('profile');
    requestAnimationFrame(() =>
      document.getElementById(`animal-${first}`)?.focus(),
    );
    return false;
  }

  function addFiles(selected: File[]) {
    const problems: string[] = [];
    const accepted: File[] = [];
    let free = MAX_PHOTOS_PER_ANIMAL - existing.length - files.length;
    for (const file of selected) {
      if (!PHOTO_TYPES.includes(file.type))
        problems.push(`${file.name}: fotografie musí být JPEG nebo PNG.`);
      else if (file.size > MAX_PHOTO_BYTES)
        problems.push(`${file.name}: soubor je větší než 10 MiB.`);
      else if (free <= 0)
        problems.push(
          `${file.name}: zvíře může mít nejvýše ${MAX_PHOTOS_PER_ANIMAL} fotografií.`,
        );
      else {
        accepted.push(file);
        free--;
      }
    }
    setPhotoProblems(problems);
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
  }

  function removeUpload(index: number) {
    setFiles(files.filter((_, position) => position !== index));
    if (primary.startsWith('new:')) {
      const selected = Number(primary.slice(4));
      if (selected === index) setPrimary('');
      else if (selected > index) setPrimary(`new:${selected - 1}`);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormProblem(undefined);
    if (!animal && step === 'profile') {
      if (checkProfile()) goTo('photos');
      return;
    }
    if (!checkProfile()) return;
    const profile = {
      name,
      species,
      breedId,
      sex,
      ...Object.fromEntries(
        optionalFields.map(({ key }) => [key, toPayload(key, values[key])]),
      ),
    };
    const initialPrimary = initialAnimal?.photos.find(
      (photo) => photo.isPrimary,
    )?.id;
    const primaryChoice = effectivePrimary.startsWith('new:')
      ? { primaryUploadIndex: Number(effectivePrimary.slice(4)) }
      : effectivePrimary && effectivePrimary !== initialPrimary
        ? { primaryPhotoId: effectivePrimary }
        : {};
    const changes = initialAnimal
      ? {
          ...(name !== initialAnimal.name ? { name } : {}),
          ...(species !== initialAnimal.species ||
          breedId !== initialAnimal.breedId
            ? { species, breedId }
            : {}),
          ...(sex !== initialAnimal.sex ? { sex } : {}),
          ...Object.fromEntries(
            optionalFields
              .filter(
                ({ key }) => values[key] !== initialValue(initialAnimal, key),
              )
              .map(({ key }) => [key, toPayload(key, values[key])]),
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
      void navigate(leaveTo);
      return;
    }
    const result = initialAnimal
      ? UpdateAnimalSchema.safeParse(changes)
      : CreateAnimalSchema.safeParse({ ...profile, ...primaryChoice });
    if (!result.success) {
      // Pojistka: pravidla výše odpovídají schématu, sem by se nemělo dojít.
      setFormProblem('Údaje nejsou platné. Zkontrolujte formulář.');
      return;
    }
    mutation.mutate(result.data);
  }

  const setValue = (key: OptionalField, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <Link
          to={leaveTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {animal ? 'Zpět na detail' : 'Moje zvířata'}
        </Link>
        <PageHeader
          eyebrow={animal ? 'Úprava zvířete' : 'Nové zvíře'}
          title={animal ? `Upravit zvíře ${animal.name}` : 'Přidat zvíře'}
          description={
            animal
              ? 'Změny údajů i fotografií se uloží najednou.'
              : 'Nejdřív vyplňte údaje, potom přidejte fotografie.'
          }
          actions={
            <Stepper
              step={step}
              onStep={(next) => {
                if (next === 'photos' && !checkProfile()) return;
                goTo(next);
              }}
            />
          }
        />
      </div>
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset disabled={mutation.isPending} className="space-y-6">
          <legend className="sr-only">
            {animal ? 'Úprava zvířete' : 'Nové zvíře'}
          </legend>
          {step === 'profile' ? (
            <Card className="space-y-5 rounded-2xl p-6">
              <div>
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-base font-semibold text-brand outline-none"
                >
                  Údaje zvířete
                </h2>
                <p className="text-sm text-muted-foreground">
                  Pole označená * jsou povinná.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="animal-name"
                  label="Jméno"
                  required
                  error={errors.name}
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <input
                      {...props}
                      className={controlClassName}
                      maxLength={120}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </Field>
                <Field id="animal-species" label="Druh" required>
                  {(props) => (
                    <select
                      {...props}
                      className={controlClassName}
                      value={species}
                      onChange={(event) => {
                        setSpecies(event.target.value as AnimalSpecies);
                        setBreedId('');
                      }}
                    >
                      <option value="dog">Pes</option>
                      <option value="horse">Kůň</option>
                    </select>
                  )}
                </Field>
                <Field
                  id="animal-breedId"
                  label="Plemeno"
                  required
                  error={errors.breedId}
                >
                  {(props) => (
                    <select
                      {...props}
                      className={controlClassName}
                      value={breedId}
                      disabled={!breeds.data}
                      onChange={(event) => setBreedId(event.target.value)}
                    >
                      <option value="">
                        {breeds.isPending
                          ? 'Načítám plemena…'
                          : 'Vyberte plemeno'}
                      </option>
                      {breeds.data?.breeds.map((breed) => (
                        <option key={breed.id} value={breed.id}>
                          {breed.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {breeds.isError && (
                  <div className="sm:col-span-2">
                    <AnimalError
                      error={breeds.error}
                      onRetry={() => void breeds.refetch()}
                    />
                  </div>
                )}
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">
                    Pohlaví
                    <span className="text-destructive" aria-hidden>
                      {' '}
                      *
                    </span>
                  </legend>
                  <div className="flex gap-2">
                    {(
                      [
                        ['male', 'Samec'],
                        ['female', 'Samice'],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className={cn(
                          'flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm transition has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                          sex === value
                            ? 'border-primary bg-accent font-medium text-accent-foreground'
                            : 'border-input bg-card hover:bg-muted',
                        )}
                      >
                        <input
                          type="radio"
                          name="sex"
                          value={value}
                          checked={sex === value}
                          onChange={() => setSex(value)}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field
                  id="animal-birthDate"
                  label="Datum narození"
                  error={errors.birthDate}
                >
                  {(props) => (
                    <input
                      {...props}
                      type="date"
                      max={today()}
                      className={controlClassName}
                      value={values.birthDate}
                      onChange={(event) =>
                        setValue('birthDate', event.target.value)
                      }
                    />
                  )}
                </Field>
                <Field
                  id="animal-weightKg"
                  label="Hmotnost (kg)"
                  error={errors.weightKg}
                >
                  {(props) => (
                    <input
                      {...props}
                      inputMode="decimal"
                      placeholder="např. 12,5"
                      maxLength={12}
                      className={controlClassName}
                      value={values.weightKg}
                      onChange={(event) =>
                        setValue('weightKg', event.target.value)
                      }
                    />
                  )}
                </Field>
                {optionalFields
                  .filter(
                    ({ key }) =>
                      key !== 'birthDate' &&
                      key !== 'weightKg' &&
                      key !== 'description',
                  )
                  .map((field) => (
                    <Field
                      key={field.key}
                      id={`animal-${field.key}`}
                      label={field.label}
                      error={errors[field.key]}
                    >
                      {(props) => (
                        <input
                          {...props}
                          className={controlClassName}
                          maxLength={'max' in field ? field.max : undefined}
                          value={values[field.key]}
                          onChange={(event) =>
                            setValue(field.key, event.target.value)
                          }
                        />
                      )}
                    </Field>
                  ))}
                <Field
                  id="animal-description"
                  label="Popis"
                  hint="Nejvýše 2000 znaků."
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <textarea
                      {...props}
                      rows={4}
                      maxLength={2000}
                      className={cn(controlClassName, 'h-auto py-2')}
                      value={values.description}
                      onChange={(event) =>
                        setValue('description', event.target.value)
                      }
                    />
                  )}
                </Field>
              </div>
            </Card>
          ) : (
            <Card className="space-y-5 rounded-2xl p-6">
              <div>
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-base font-semibold text-brand outline-none"
                >
                  Fotografie
                </h2>
                <p className="text-sm text-muted-foreground">
                  JPEG nebo PNG, nejvýše 10 MiB na soubor a{' '}
                  {MAX_PHOTOS_PER_ANIMAL} fotografií. Hlavní fotografie se
                  zobrazuje na kartě zvířete.
                </p>
              </div>
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input bg-muted/50 px-4 py-8 text-center text-sm transition hover:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <ImagePlus
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
                <span className="font-medium">Přidat fotografie</span>
                <span className="text-xs text-muted-foreground">
                  Vyberte soubory nebo je sem přetáhněte ({tiles.length}/
                  {MAX_PHOTOS_PER_ANIMAL})
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png"
                  className="sr-only"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
              </label>
              {photoProblems.length > 0 && (
                <Alert variant="error" onDismiss={() => setPhotoProblems([])}>
                  <ul className="space-y-1">
                    {photoProblems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {tiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Zatím žádné fotografie. Můžete je přidat i později.
                </p>
              ) : (
                <div role="radiogroup" aria-label="Hlavní fotografie">
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {existing.map((photo) => (
                      <PhotoTile
                        key={photo.id}
                        name={photo.fileName}
                        primary={effectivePrimary === photo.id}
                        preview={
                          <img
                            src={photoUrl(animal!.id, photo.id, 'thumbnail')}
                            alt=""
                            className="size-full object-cover"
                          />
                        }
                        onPrimary={() => setPrimary(photo.id)}
                        onRemove={() => {
                          setRemoved([...removed, photo.id]);
                          if (primary === photo.id) setPrimary('');
                        }}
                      />
                    ))}
                    {files.map((file, index) => (
                      <PhotoTile
                        key={`${index}-${file.name}-${file.lastModified}`}
                        name={file.name}
                        primary={effectivePrimary === `new:${index}`}
                        preview={<UploadPreview file={file} />}
                        onPrimary={() => setPrimary(`new:${index}`)}
                        onRemove={() => removeUpload(index)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
          {formProblem && (
            <Alert variant="error" onDismiss={() => setFormProblem(undefined)}>
              {formProblem}
            </Alert>
          )}
          {mutation.isError && (
            <AnimalError
              error={mutation.error}
              onDismiss={() => mutation.reset()}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {!animal && step === 'photos' && (
                <Button variant="ghost" onClick={() => goTo('profile')}>
                  <ArrowLeft aria-hidden />
                  Zpět na údaje
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => void navigate(leaveTo)}>
                Zrušit
              </Button>
              <Button type="submit" disabled={!breeds.data}>
                {mutation.isPending
                  ? 'Ukládám…'
                  : animal
                    ? 'Uložit změny'
                    : step === 'profile'
                      ? 'Pokračovat na fotografie'
                      : 'Uložit zvíře'}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
