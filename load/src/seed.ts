import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import {
  AdminVerificationRequestSchema,
  AnimalDocumentListSchema,
  AnimalListSchema,
  AnimalSchema,
  MyAccountSchema,
  animalBreeds,
  type AnimalSpecies,
} from '@anico/shared-schemas';
import { createSession, seedUser } from '@anico/e2e/sessions';
import { pdfFile } from '@anico/e2e/files';
import type { LoadConfig } from './config.ts';
import { expectJson, gatewayFetch, inPool, type Account } from './http.ts';
import type { StackInfo } from './stack.ts';

/** Ověřený chovatel se zvířaty; `pages` = kurzory stránek (`null` = první). */
export interface VerifiedBreeder {
  account: Account;
  animalIds: string[];
  pages: Array<string | null>;
}

/** Žádost ve stavu PENDING (fronta admina nebo cíl souběhu). */
export interface PendingRequest {
  account: Account;
  requestId: string;
  revision: number;
}

/** Aktuální doklad PENDING (fronta revizí nebo cíl souběhu). */
export interface PendingDocument {
  animalId: string;
  documentId: string;
}

export interface SeedResult {
  admins: [Account, Account];
  breeders: VerifiedBreeder[];
  /** Cíle souběžného rozhodování; zbytek žádostí zůstává ve frontě. */
  race: {
    requests: Record<'gateway' | 'direct', PendingRequest[]>;
    documents: Record<'gateway' | 'direct', PendingDocument[]>;
  };
  summary: {
    verifiedBreeders: number;
    animals: number;
    pendingDocuments: number;
    pendingRequests: number;
    durationMs: number;
  };
}

const SEED_CONCURRENCY = 8;
const DOCUMENT_TYPES = ['PEDIGREE', 'HEALTH_RESULTS', 'BREEDING_APPROVAL'];

/**
 * Připraví data přes skutečná API za gateway (žádosti, schválení, zvířata,
 * doklady), aby platily invarianty služeb. Přímo do DB auth-service se zapisují
 * jen účty a relace – stejně jako v E2E, protože přihlášení přes Google
 * /Microsoft lokálně nejde a testovací účty jsou za rate limitem auth-service.
 */
export async function seed(
  info: StackInfo,
  config: LoadConfig,
): Promise<SeedResult> {
  const started = Date.now();
  const client = await MongoClient.connect(info.databases.auth);
  try {
    const account = async (
      givenName: string,
      familyName: string,
      roles: Account['user']['roles'],
    ): Promise<Account> => {
      const user = await seedUser(client, { givenName, familyName, roles });
      return { user, session: await createSession(client, user.userId) };
    };
    const admin: Account = {
      user: info.users.admin,
      session: await createSession(client, info.users.admin.userId),
    };
    const secondAdmin = await account('Bára', 'Druhá', ['breeder', 'admin']);
    const raceDocuments = config.raceRounds * 2;
    const totalAnimals = config.breeders * config.animalsPerBreeder;
    if (totalAnimals < raceDocuments)
      throw new Error(
        `Na souběh dokladů je potřeba ${raceDocuments} zvířat, seed jich založí ${totalAnimals}; zvyšte --breeders/--animals`,
      );

    const submit = async (index: number, label: string) => {
      const breeder = await account(`Chovatel${index}`, label, ['breeder']);
      const form = new FormData();
      form.append('firstName', `Chovatel${index}`);
      form.append('lastName', label);
      form.append('emailAddress', breeder.user.email);
      form.append('breedingStationName', `Stanice ${label} ${index}`);
      form.append('breedingStationNumber', `CZ-${index}-${randomInt(1e6)}`);
      const certificate = pdfFile('osvedceni.pdf', `Osvedceni ${index}`);
      form.append(
        'breedingStationCertificate',
        new Blob([certificate.buffer], { type: certificate.mimeType }),
        certificate.name,
      );
      const submitted = await expectJson(
        await gatewayFetch(
          info,
          breeder,
          'POST',
          '/api/breeder/breeders/me/verification-request',
          form,
        ),
        201,
        MyAccountSchema,
        'Podání žádosti o ověření',
      );
      const request = submitted.verificationRequest!;
      return {
        account: breeder,
        requestId: request.id,
        revision: request.revision,
      };
    };

    // 1) ověření chovatelé: žádost → schválení → projekce v animal-service
    const verified = await inPool(
      Array.from({ length: config.breeders }, (_, index) => index),
      SEED_CONCURRENCY,
      async (index) => {
        const pending = await submit(index, 'Ověřený');
        await expectJson(
          await gatewayFetch(
            info,
            admin,
            'POST',
            `/api/breeder/verification-requests/${pending.requestId}/decision`,
            { decision: 'APPROVED', revision: pending.revision },
          ),
          200,
          AdminVerificationRequestSchema,
          'Schválení žádosti',
        );
        await waitForAnimalAccess(info, pending.account);
        return pending.account;
      },
    );

    // 2) zvířata (JSON i CSRF jako frontend) a jedno podání dokladu u každého
    const animals = await inPool(
      verified.flatMap((breeder) =>
        Array.from({ length: config.animalsPerBreeder }, (_, index) => ({
          breeder,
          index,
        })),
      ),
      SEED_CONCURRENCY,
      async ({ breeder, index }) => {
        const animal = await expectJson(
          await gatewayFetch(
            info,
            breeder,
            'POST',
            '/api/animal/animals',
            animalInput(`${breeder.user.familyName} ${index}`, index),
          ),
          201,
          AnimalSchema,
          'Založení zvířete',
        );
        const form = new FormData();
        const type = DOCUMENT_TYPES[index % DOCUMENT_TYPES.length]!;
        const file = pdfFile('doklad.pdf', `Doklad ${animal.id}`);
        form.append('documentTypes', type);
        form.append(
          'files',
          new Blob([file.buffer], { type: file.mimeType }),
          file.name,
        );
        const documents = await expectJson(
          await gatewayFetch(
            info,
            breeder,
            'POST',
            `/api/animal/animals/${animal.id}/documents`,
            form,
          ),
          201,
          AnimalDocumentListSchema,
          'Podání dokladu',
        );
        return {
          owner: breeder.user.userId,
          animalId: animal.id,
          documentId: documents.documents[0]!.id,
        };
      },
    );

    // 3) kurzory stránek pro scénář stránkování
    const breeders = await inPool(
      verified,
      SEED_CONCURRENCY,
      async (account) => {
        const pages: Array<string | null> = [null];
        const animalIds: string[] = [];
        for (;;) {
          const before = pages.at(-1);
          const page = await expectJson(
            await gatewayFetch(
              info,
              account,
              'GET',
              `/api/animal/animals?limit=${config.pageSize}${before ? `&before=${before}` : ''}`,
            ),
            200,
            AnimalListSchema,
            'Stránka zvířat',
          );
          animalIds.push(...page.items.map((item) => item.id));
          if (!page.nextCursor) break;
          pages.push(page.nextCursor);
        }
        if (animalIds.length !== config.animalsPerBreeder)
          throw new Error(
            `Chovatel vidí ${animalIds.length} zvířat místo ${config.animalsPerBreeder}`,
          );
        return { account, animalIds, pages };
      },
    );

    // 4) žádosti ve frontě admina a cíle souběhu (zůstávají PENDING)
    const queued = await inPool(
      Array.from(
        { length: config.pendingRequests + config.raceRounds * 2 },
        (_, index) => index,
      ),
      SEED_CONCURRENCY,
      (index) => submit(index, 'Čekající'),
    );
    const raceRequests = queued.slice(config.pendingRequests);
    const raceTargets = animals
      .filter((_, index) => index % 2 === 0)
      .concat(animals.filter((_, index) => index % 2 === 1))
      .slice(0, raceDocuments)
      .map(({ animalId, documentId }) => ({ animalId, documentId }));

    return {
      admins: [admin, secondAdmin],
      breeders,
      race: {
        requests: {
          gateway: raceRequests.slice(0, config.raceRounds),
          direct: raceRequests.slice(config.raceRounds),
        },
        documents: {
          gateway: raceTargets.slice(0, config.raceRounds),
          direct: raceTargets.slice(config.raceRounds),
        },
      },
      summary: {
        verifiedBreeders: breeders.length,
        animals: animals.length,
        pendingDocuments: animals.length,
        pendingRequests: queued.length,
        durationMs: Date.now() - started,
      },
    };
  } finally {
    await client.close();
  }
}

/** Unikátní platné údaje zvířete; plemeno vždy z katalogu daného druhu. */
export function animalInput(name: string, index: number) {
  const species: AnimalSpecies = index % 3 === 2 ? 'horse' : 'dog';
  const breeds = animalBreeds(species);
  return {
    name: `Zátěž ${name}`.slice(0, 120),
    species,
    breedId: breeds[index % breeds.length]!.id,
    sex: index % 2 === 0 ? 'female' : 'male',
    birthDate: '2021-04-15',
    city: 'Brno',
    microchipNumber: `203${String(randomInt(1e12)).padStart(12, '0')}`,
  };
}

/** animal-service odemkne zvířata až po projekci `breeder.verified` z NATS. */
async function waitForAnimalAccess(info: StackInfo, account: Account) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await gatewayFetch(
      info,
      account,
      'GET',
      '/api/animal/animals?limit=1',
    );
    await response.body?.cancel();
    if (response.status === 200) return;
    if (response.status !== 403)
      throw new Error(
        `Čekání na projekci: neočekávaný HTTP ${response.status}`,
      );
    await delay(100);
  }
  throw new Error('animal-service nepřijal breeder.verified do 30 s');
}
