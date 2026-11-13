/**
 * animal-service → frontend (UC-02, UC-03): skutečné funkce `features/animals/api.ts`
 * a `features/documents/api.ts` proti skutečnému animal-service za gateway – zvíře
 * bez fotografií i s nimi, stránkování, doklady ve všech stavech a ve více verzích.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { z } from 'zod';
import { animalBreeds, type CreateAnimalInput } from '@anico/shared-schemas';
import {
  animalQuery,
  breedsQuery,
  deleteAnimal,
  listAnimals,
  photoUrl,
  saveAnimal,
} from '@/features/animals/api';
import { isUnverifiedBreeder } from '@/features/animals/AnimalError';
import {
  decideDocument,
  documentConflict,
  documentsQuery,
  downloadDocument,
  historyQuery,
  replaceDocument,
  reviewQueueQuery,
  submitDocuments,
} from '@/features/documents/api';
import { isApiError } from '@/shared/lib/http';
import { FIELD_LABEL } from '@/features/animals/fields';
import { currentSession, run } from '../support/frontend.js';
import {
  startStack,
  type SignedInBrowser,
  type Stack,
} from '../support/stack.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const pdf = (name: string) =>
  new File([PDF], name, { type: 'application/pdf' });
const image = async (format: 'png' | 'jpeg', name: string) => {
  const content = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#3f8c5b' },
  })
    [format]()
    .toBuffer();
  return new File([new Uint8Array(content)], name, { type: `image/${format}` });
};
const dog: CreateAnimalInput = {
  name: 'Argo',
  species: 'dog',
  breedId: animalBreeds('dog')[0]!.id,
  sex: 'female',
};
const signal = () => new AbortController().signal;
const IssuesSchema = z.array(z.object({ path: z.array(z.unknown()) }));

let stack: Stack;
let breeder: SignedInBrowser;
let admin: SignedInBrowser;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isApiError(error)) throw new Error('Expected an API error');
  return error;
}
async function asBreeder() {
  stack.use(breeder);
  return (await currentSession()).csrfToken;
}
async function asAdmin() {
  stack.use(admin);
  return (await currentSession()).csrfToken;
}

beforeAll(async () => {
  stack = await startStack();
  vi.stubGlobal('fetch', stack.fetch);
  admin = await stack.login('posuzovatel-dokladu', { role: 'admin' });
  breeder = await stack.login('majitelka');
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await stack?.close();
});

describe('zvířata (AnimalSchema, AnimalListSchema, katalog plemen)', () => {
  it('neověřený chovatel dostane 403 s kódem, podle kterého frontend ukáže výzvu k ověření', async () => {
    stack.use(breeder);
    const error = await failure(listAnimals({}, null, signal()));
    expect(isUnverifiedBreeder(error)).toBe(true);
  });

  it('katalog plemen obou druhů projde inline schématem `breedsQuery`', async () => {
    stack.use(breeder);
    for (const species of ['dog', 'horse'] as const) {
      const catalog = await run(breedsQuery(species));
      expect(catalog.species).toBe(species);
      expect(catalog.breeds).toEqual(animalBreeds(species));
    }
  });

  it('založení bez fotografií i s nimi, úprava fotografií, detail, soubor fotografie a smazání', async () => {
    await stack.animal.verification.project({
      eventId: randomUUID(),
      type: 'breeder.verified',
      schemaVersion: 1,
      producer: 'breeder-service',
      occurredAt: new Date().toISOString(),
      data: { breederId: breeder.userId, verifiedAt: new Date().toISOString() },
    });
    const csrf = await asBreeder();
    const bare = await saveAnimal(dog, [], csrf);
    expect(bare).toMatchObject({
      ownerUserId: breeder.userId,
      photos: [],
      birthDate: null,
      weightKg: null,
      documentsState: 'NOT_SUBMITTED',
    });

    const withPhotos = await saveAnimal(
      {
        ...dog,
        name: 'Bára',
        birthDate: '2020-05-01',
        weightKg: 21.5,
        microchipNumber: '203 098 100 123 456',
        primaryUploadIndex: 1,
      },
      [await image('png', 'první.png'), await image('jpeg', 'druhá.jpg')],
      csrf,
    );
    expect(withPhotos.photos).toMatchObject([
      { fileName: 'první.png', contentType: 'image/png', isPrimary: false },
      { fileName: 'druhá.jpg', contentType: 'image/jpeg', isPrimary: true },
    ]);
    const [first, primary] = withPhotos.photos;

    const changed = await saveAnimal(
      { removePhotoIds: [primary!.id], primaryUploadIndex: 0, city: 'Brno' },
      [await image('jpeg', 'třetí.jpg')],
      csrf,
      withPhotos.id,
    );
    expect(changed.photos).toMatchObject([
      { id: first!.id, isPrimary: false },
      { fileName: 'třetí.jpg', isPrimary: true },
    ]);
    expect(await run(animalQuery(withPhotos.id))).toEqual(changed);
    // úprava bez nových souborů jde jako JSON, ne multipart
    const jsonEdit = await saveAnimal(
      { primaryPhotoId: first!.id, city: null },
      [],
      csrf,
      withPhotos.id,
    );
    expect(jsonEdit).toMatchObject({
      city: null,
      photos: [{ id: first!.id, isPrimary: true }, { isPrimary: false }],
    });

    // 400: frontend mapuje `issues[].path[0]` na popisky polí formuláře
    const invalid = await failure(
      saveAnimal({ weightKg: 5000 }, [], csrf, withPhotos.id),
    );
    expect(invalid.kind).toBe('rejected');
    const [key] = IssuesSchema.parse(invalid.issues).map(({ path }) => path[0]);
    expect(key).toBe('weightKg');
    expect(FIELD_LABEL[key as string]).toBeDefined();

    // `photoUrl` je src obrázků: cesta i varianty musí existovat
    for (const size of [undefined, 'thumbnail', 'preview'] as const) {
      const response = await fetch(photoUrl(changed.id, first!.id, size));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^image\//);
    }

    await deleteAnimal(bare.id, csrf);
    const gone = await failure(run(animalQuery(bare.id)));
    expect(gone.status).toBe(404);
  });

  it('seznam se stránkováním a filtrem projde schématem na obou stranách kurzoru', async () => {
    const csrf = await asBreeder();
    const horse: CreateAnimalInput = {
      name: 'Hrom',
      species: 'horse',
      breedId: animalBreeds('horse')[0]!.id,
      sex: 'male',
    };
    for (let index = 0; index < 21; index++)
      await saveAnimal({ ...horse, name: `Hrom ${index}` }, [], csrf);
    const filter = { species: 'horse' as const, breedId: horse.breedId };
    const page = await listAnimals(filter, null, signal());
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
    const rest = await listAnimals(filter, page.nextCursor, signal());
    expect(rest).toMatchObject({ nextCursor: null });
    expect(rest.items).toHaveLength(1);
    const dogs = await listAnimals(
      { species: 'dog', sex: 'female' },
      null,
      signal(),
    );
    expect(dogs.items.length).toBeGreaterThan(0);
    expect(dogs.items.every((animal) => animal.species === 'dog')).toBe(true);
  });
});

describe('doklady (AnimalDocument*/DocumentReviewListSchema)', () => {
  it('podání, fronta, schválení, zamítnutí, nová verze, historie a konflikt', async () => {
    let csrf = await asBreeder();
    const animal = await saveAnimal({ ...dog, name: 'Doklady' }, [], csrf);
    expect(await run(documentsQuery(animal.id))).toEqual({
      animalId: animal.id,
      documentsState: 'NOT_SUBMITTED',
      documents: [],
    });

    const submitted = await submitDocuments(
      animal.id,
      [
        { file: pdf('průkaz.pdf'), documentType: 'PEDIGREE' },
        { file: pdf('zdraví.pdf'), documentType: 'HEALTH_RESULTS' },
      ],
      csrf,
    );
    expect(submitted.documentsState).toBe('PENDING');
    const [pedigree, health] = submitted.documents;
    expect(pedigree).toMatchObject({
      versionNumber: 1,
      previousDocumentId: null,
      isCurrent: true,
      assessmentStatus: 'PENDING',
      reviewedBy: null,
      file: { fileName: 'průkaz.pdf', contentType: 'application/pdf' },
    });
    expect((await run(animalQuery(animal.id))).documentsState).toBe('PENDING');

    csrf = await asAdmin();
    const queue = await run(reviewQueueQuery);
    expect(queue.items.map(({ document }) => document.id)).toEqual(
      expect.arrayContaining([pedigree!.id, health!.id]),
    );
    expect(queue.items[0]!.animal).toMatchObject({
      id: animal.id,
      ownerUserId: breeder.userId,
      microchipNumber: null,
    });
    expect(
      Buffer.from(
        await (await downloadDocument(animal.id, pedigree!.id)).arrayBuffer(),
      ),
    ).toEqual(PDF);
    const approved = await decideDocument(
      animal.id,
      pedigree!.id,
      { decision: 'APPROVED' },
      csrf,
    );
    expect(approved).toMatchObject({
      assessmentStatus: 'APPROVED',
      reviewedBy: admin.userId,
      rejectionReason: null,
    });
    const rejected = await decideDocument(
      animal.id,
      health!.id,
      { decision: 'REJECTED', rejectionReason: 'Nečitelné' },
      csrf,
    );
    expect(rejected).toMatchObject({
      assessmentStatus: 'REJECTED',
      rejectionReason: 'Nečitelné',
    });
    const conflict = documentConflict(
      await failure(
        decideDocument(animal.id, pedigree!.id, { decision: 'APPROVED' }, csrf),
      ),
    );
    expect(conflict).toEqual({ current: approved });

    csrf = await asBreeder();
    // UC-03/7: PENDING > APPROVED > REJECTED
    expect((await run(documentsQuery(animal.id))).documentsState).toBe(
      'APPROVED',
    );
    const replacement = await replaceDocument(
      animal.id,
      health!.id,
      pdf('zdraví-2.pdf'),
      csrf,
    );
    expect(replacement).toMatchObject({
      versionNumber: 2,
      previousDocumentId: health!.id,
      isCurrent: true,
      assessmentStatus: 'PENDING',
    });
    const history = await run(historyQuery(animal.id, replacement.id));
    expect(history).toMatchObject({
      animalId: animal.id,
      animal: { id: animal.id, name: 'Doklady' },
      documentType: 'HEALTH_RESULTS',
    });
    expect(history.versions.map((version) => version.isCurrent)).toEqual([
      false,
      true,
    ]);
    const stale = documentConflict(
      await failure(
        replaceDocument(animal.id, health!.id, pdf('pozdě.pdf'), csrf),
      ),
    );
    expect(stale).toEqual({ current: replacement });

    csrf = await asAdmin();
    await decideDocument(
      animal.id,
      replacement.id,
      { decision: 'APPROVED' },
      csrf,
    );
    stack.use(breeder);
    expect((await run(documentsQuery(animal.id))).documentsState).toBe(
      'APPROVED',
    );
    expect((await run(animalQuery(animal.id))).documentsState).toBe('APPROVED');
  });

  it('zvíře se samými zamítnutými doklady má stav REJECTED', async () => {
    let csrf = await asBreeder();
    const animal = await saveAnimal({ ...dog, name: 'Zamítnutý' }, [], csrf);
    const {
      documents: [only],
    } = await submitDocuments(
      animal.id,
      [{ file: pdf('svod.pdf'), documentType: 'BREEDING_APPROVAL' }],
      csrf,
    );
    csrf = await asAdmin();
    await decideDocument(
      animal.id,
      only!.id,
      { decision: 'REJECTED', rejectionReason: 'Neplatné' },
      csrf,
    );
    stack.use(breeder);
    expect((await run(documentsQuery(animal.id))).documentsState).toBe(
      'REJECTED',
    );
    expect((await run(animalQuery(animal.id))).documentsState).toBe('REJECTED');
    const { items } = await listAnimals({ species: 'dog' }, null, signal());
    expect(items.find(({ id }) => id === animal.id)?.documentsState).toBe(
      'REJECTED',
    );
  });
});
