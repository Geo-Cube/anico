import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient, ObjectId, type Collection } from 'mongodb';
import {
  AdminVerificationRequestSchema,
  AnimalDocumentSchema,
} from '@anico/shared-schemas';
import type { LoadConfig } from './config.ts';
import { gatewayFetch, type Account, type IdentityTokens } from './http.ts';
import type { Layer } from './measure.ts';
import type { PendingDocument, PendingRequest, SeedResult } from './seed.ts';
import type { StackInfo } from './stack.ts';

/** Jedno kolo: všichni soupeři rozhodují tutéž žádost/doklad současně. */
export interface RaceRound {
  kind: 'verification' | 'document';
  layer: Layer;
  target: string;
  contenders: Array<{ admin: string; decision: string; status: number }>;
  winner: { admin: string; decision: string } | null;
  violations: string[];
}

export interface RaceReport {
  rounds: RaceRound[];
  /** Souhrn statusů všech soupeřů podle druhu a vrstvy. */
  statuses: Record<string, Record<string, number>>;
  consistency: {
    checkedRequests: number;
    checkedDocuments: number;
    approvedBreeders: number;
    publishedEvents: number;
    projectedBreeders: number;
    outboxWaitMs: number;
    /** Co kontrola dat nepokrývá (bez přístupu k NATS streamu). */
    limitations: string[];
  };
  violations: string[];
}

const VERIFICATION_DECISIONS = [
  { decision: 'APPROVED' },
  { decision: 'REJECTED', rejectionReason: 'Zátěžový test: zamítnutí' },
  { decision: 'RETURNED', returnReason: 'Zátěžový test: vrácení' },
] as const;
const DOCUMENT_DECISIONS = [
  { decision: 'APPROVED' },
  { decision: 'REJECTED', rejectionReason: 'Zátěžový test: zamítnutí' },
] as const;
const OUTBOX_TIMEOUT_MS = 30_000;

/**
 * Invariant „o každém kole rozhoduje nejvýše jeden administrátor“ pod
 * souběhem: dva administrátoři pošlou současně několik rozhodnutí o téže
 * žádosti (breeder-service) a o témže dokladu (animal-service). Přesně jedno
 * smí uspět (200), ostatní musí dostat 409. Potom se z DB ověří konzistence:
 * jedna položka historie, rozhodl vítěz, outbox drží právě jednu událost na
 * schválení, ta je publikovaná a projekce v animal-service nese její `eventId`.
 * Porušení se jen hlásí (s cílem a statusy pro reprodukci), nic se neopravuje.
 */
export async function raceDecisions(
  info: StackInfo,
  config: LoadConfig,
  data: SeedResult,
  tokens: IdentityTokens,
): Promise<RaceReport> {
  const send = (
    layer: Layer,
    admin: Account,
    service: 'breeder' | 'animal',
    path: string,
    body: Record<string, unknown>,
  ) =>
    layer === 'gateway'
      ? gatewayFetch(info, admin, 'POST', `/api/${service}${path}`, body)
      : fetch(`${info.services[service]}${path}`, {
          method: 'POST',
          headers: {
            ...tokens.headers(admin.user),
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
  const contenders = <T>(decisions: readonly T[]) =>
    data.admins.flatMap((admin, adminIndex) =>
      Array.from({ length: config.racePerAdmin }, (_, k) => ({
        admin,
        decision:
          decisions[(adminIndex * config.racePerAdmin + k) % decisions.length]!,
      })),
    );

  const rounds: RaceRound[] = [];
  const winners = new Map<string, { admin: string; decision: string }>();

  const settle = async (
    kind: RaceRound['kind'],
    layer: Layer,
    target: string,
    attempts: Array<{
      admin: Account;
      decision: { decision: string };
      response: Promise<Response>;
    }>,
    validate: (
      body: unknown,
      winner: { admin: string; decision: string },
    ) => string[],
  ) => {
    const results = await Promise.all(
      attempts.map(async (attempt) => {
        const response = await attempt.response;
        return {
          admin: attempt.admin.user.userId,
          decision: attempt.decision.decision,
          status: response.status,
          body: await response.text(),
        };
      }),
    );
    const violations: string[] = [];
    const succeeded = results.filter((result) => result.status === 200);
    const other = results.filter(
      (result) => result.status !== 200 && result.status !== 409,
    );
    if (succeeded.length !== 1)
      violations.push(
        `${kind} ${target} (${layer}): uspělo ${succeeded.length} rozhodnutí místo právě jednoho`,
      );
    for (const result of other)
      violations.push(
        `${kind} ${target} (${layer}): neočekávaný HTTP ${result.status} ${result.body.slice(0, 200)}`,
      );
    const winner = succeeded.length === 1 ? succeeded[0]! : null;
    if (winner) {
      winners.set(target, { admin: winner.admin, decision: winner.decision });
      violations.push(
        ...validate(JSON.parse(winner.body), winner).map(
          (message) => `${kind} ${target} (${layer}): ${message}`,
        ),
      );
    }
    rounds.push({
      kind,
      layer,
      target,
      contenders: results.map(({ admin, decision, status }) => ({
        admin,
        decision,
        status,
      })),
      winner: winner
        ? { admin: winner.admin, decision: winner.decision }
        : null,
      violations,
    });
  };

  const animalDb = await MongoClient.connect(info.databases.animal);
  const breederDb = await MongoClient.connect(info.databases.breeder);
  try {
    const animals = animalDb.db().collection('animals');
    const allDocuments = [
      ...data.race.documents.gateway,
      ...data.race.documents.direct,
    ];
    const revisionsBefore = new Map(
      (
        await animals
          .find(
            { _id: { $in: allDocuments.map((d) => new ObjectId(d.animalId)) } },
            { projection: { documentsRevision: 1 } },
          )
          .toArray()
      ).map((doc) => [doc._id.toHexString(), doc.documentsRevision as number]),
    );

    for (const layer of ['gateway', 'direct'] as const) {
      for (const request of data.race.requests[layer]) {
        const body = (decision: object) => ({
          ...decision,
          revision: request.revision,
        });
        await settle(
          'verification',
          layer,
          request.requestId,
          contenders(VERIFICATION_DECISIONS).map(({ admin, decision }) => ({
            admin,
            decision,
            response: send(
              layer,
              admin,
              'breeder',
              `/verification-requests/${request.requestId}/decision`,
              body(decision),
            ),
          })),
          (raw, winner) => {
            const decided = AdminVerificationRequestSchema.parse(raw);
            return [
              ...(decided.status !== winner.decision
                ? [`odpověď vítěze má stav ${decided.status}`]
                : []),
              ...(decided.reviewHistory.length !== 1
                ? [
                    `odpověď vítěze má ${decided.reviewHistory.length} položek historie`,
                  ]
                : []),
            ];
          },
        );
      }
      for (const document of data.race.documents[layer]) {
        await settle(
          'document',
          layer,
          document.documentId,
          contenders(DOCUMENT_DECISIONS).map(({ admin, decision }) => ({
            admin,
            decision,
            response: send(
              layer,
              admin,
              'animal',
              `/animals/${document.animalId}/documents/${document.documentId}/decision`,
              decision,
            ),
          })),
          (raw, winner) => {
            const decided = AnimalDocumentSchema.parse(raw);
            return decided.assessmentStatus !== winner.decision ||
              decided.reviewedBy !== winner.admin
              ? [
                  `odpověď vítěze: ${decided.assessmentStatus} od ${decided.reviewedBy}`,
                ]
              : [];
          },
        );
      }
    }

    const violations = rounds.flatMap((round) => round.violations);
    violations.push(
      ...(await checkDocuments(
        animals,
        allDocuments,
        winners,
        revisionsBefore,
      )),
    );
    const outbox = await checkVerifications(
      breederDb,
      animalDb,
      [...data.race.requests.gateway, ...data.race.requests.direct],
      winners,
    );
    violations.push(...outbox.violations);

    const statuses: RaceReport['statuses'] = {};
    for (const round of rounds) {
      const key = `${round.kind}.${round.layer}`;
      statuses[key] ??= {};
      for (const contender of round.contenders)
        statuses[key][contender.status] =
          (statuses[key][contender.status] ?? 0) + 1;
    }
    return {
      rounds,
      statuses,
      consistency: {
        checkedRequests:
          data.race.requests.gateway.length + data.race.requests.direct.length,
        checkedDocuments: allDocuments.length,
        approvedBreeders: outbox.approved,
        publishedEvents: outbox.published,
        projectedBreeders: outbox.projected,
        outboxWaitMs: outbox.waitMs,
        limitations: [
          'Zprávy v NATS streamu se nepočítají (launcher nezveřejňuje přihlašovací údaje brokeru); jedna událost na schválení se ověřuje přes outbox (`verificationEvent`) a `eventId` projekce v animal-service.',
        ],
      },
      violations,
    };
  } finally {
    await animalDb.close();
    await breederDb.close();
  }
}

/** Doklad: jediné rozhodnutí vítěze, revize dokladů zvířete +1 právě jednou. */
async function checkDocuments(
  animals: Collection,
  targets: PendingDocument[],
  winners: Map<string, { admin: string; decision: string }>,
  revisionsBefore: Map<string, number>,
) {
  const violations: string[] = [];
  for (const target of targets) {
    const animal = await animals.findOne({
      _id: new ObjectId(target.animalId),
    });
    const versions = (animal?.documents ?? []) as Array<{
      _id: ObjectId;
      isCurrent: boolean;
      assessmentStatus: string;
      reviewedBy: string | null;
    }>;
    const version = versions.find((item) =>
      item._id.equals(new ObjectId(target.documentId)),
    );
    const winner = winners.get(target.documentId);
    const prefix = `document ${target.documentId} (DB)`;
    if (!version) {
      violations.push(`${prefix}: verze dokladu chybí`);
      continue;
    }
    if (!winner) continue; // chybějící vítěz už je nahlášen z odpovědí
    if (
      version.assessmentStatus !== winner.decision ||
      version.reviewedBy !== winner.admin
    )
      violations.push(
        `${prefix}: uloženo ${version.assessmentStatus} od ${version.reviewedBy}, vítěz ${winner.decision} od ${winner.admin}`,
      );
    // seed zakládá u každého zvířete jediný doklad, cíle jsou různá zvířata
    const expected = (revisionsBefore.get(target.animalId) ?? 0) + 1;
    if (animal?.documentsRevision !== expected)
      violations.push(
        `${prefix}: documentsRevision ${String(animal?.documentsRevision)}, očekáváno ${expected} (jedno rozhodnutí = +1)`,
      );
  }
  return violations;
}

interface StoredBreeder {
  breederId: string;
  isVerified: boolean;
  verificationRequest: {
    _id: ObjectId;
    status: string;
    reviewedBy: string | null;
    reviewHistory: Array<{ decision: string; reviewedBy: string }>;
  } | null;
  verificationEvent?: {
    id: string;
    status: 'pending' | 'published' | 'failed';
    event: { eventId: string; data: { breederId: string } };
  };
}

/**
 * Žádosti: jedna položka historie od vítěze, `isVerified` odpovídá stavu,
 * outbox událost existuje právě u schválených; po doručení (čeká se) má každý
 * schválený chovatel právě jednu projekci se shodným `eventId`. Kontroluje se
 * i celá kolekce (včetně schválení ze seedu).
 */
async function checkVerifications(
  breederDb: MongoClient,
  animalDb: MongoClient,
  targets: PendingRequest[],
  winners: Map<string, { admin: string; decision: string }>,
) {
  const violations: string[] = [];
  const breeders = breederDb.db().collection<StoredBreeder>('breeders');
  for (const target of targets) {
    const prefix = `verification ${target.requestId} (DB)`;
    const stored = await breeders.findOne({
      'verificationRequest._id': new ObjectId(target.requestId),
    });
    const request = stored?.verificationRequest;
    const winner = winners.get(target.requestId);
    if (!stored || !request) {
      violations.push(`${prefix}: žádost chybí`);
      continue;
    }
    if (request.reviewHistory.length !== 1)
      violations.push(
        `${prefix}: ${request.reviewHistory.length} rozhodnutí v historii (${request.reviewHistory.map((review) => `${review.decision}/${review.reviewedBy}`).join(', ')})`,
      );
    if (
      winner &&
      (request.status !== winner.decision ||
        request.reviewedBy !== winner.admin)
    )
      violations.push(
        `${prefix}: uloženo ${request.status} od ${request.reviewedBy}, vítěz ${winner.decision} od ${winner.admin}`,
      );
  }

  // celá kolekce: konzistence stavu, isVerified a outboxu
  const all = await breeders.find({}).toArray();
  for (const breeder of all) {
    const prefix = `breeder ${breeder.breederId} (DB)`;
    const status = breeder.verificationRequest?.status;
    const approvals =
      breeder.verificationRequest?.reviewHistory.filter(
        (review) => review.decision === 'APPROVED',
      ).length ?? 0;
    if (approvals > 1)
      violations.push(`${prefix}: ${approvals} schválení v historii`);
    if (breeder.isVerified !== (status === 'APPROVED'))
      violations.push(
        `${prefix}: isVerified=${breeder.isVerified} při stavu ${status}`,
      );
    if ((status === 'APPROVED') !== Boolean(breeder.verificationEvent))
      violations.push(
        `${prefix}: outbox událost ${breeder.verificationEvent ? 'existuje' : 'chybí'} při stavu ${status}`,
      );
    const event = breeder.verificationEvent;
    if (
      event &&
      (event.event.eventId !== event.id ||
        event.event.data.breederId !== breeder.breederId)
    )
      violations.push(`${prefix}: outbox událost nesedí (id/breederId)`);
  }

  // doručení: outbox → NATS → projekce v animal-service
  const started = Date.now();
  const approvedFilter = { 'verificationRequest.status': 'APPROVED' };
  let pending = Infinity;
  while (Date.now() - started < OUTBOX_TIMEOUT_MS) {
    pending = await breeders.countDocuments({
      ...approvedFilter,
      'verificationEvent.status': { $ne: 'published' },
    });
    if (pending === 0) break;
    await delay(200);
  }
  const waitMs = Date.now() - started;
  if (pending !== 0)
    violations.push(
      `outbox: ${pending} schválení nepublikováno do ${OUTBOX_TIMEOUT_MS / 1000} s`,
    );
  const approved = await breeders.find(approvedFilter).toArray();
  const projections = animalDb.db().collection('verifiedBreeders');
  // projekce běží po publikaci asynchronně (consumer); krátce na ni počkej
  const expectedIds = approved.map((breeder) => breeder.breederId);
  let projected: Array<{ breederId: string; eventId: string }> = [];
  for (
    const deadline = Date.now() + OUTBOX_TIMEOUT_MS;
    Date.now() < deadline;
  ) {
    projected = (await projections
      .find({}, { projection: { _id: 0, breederId: 1, eventId: 1 } })
      .toArray()) as unknown as typeof projected;
    if (expectedIds.every((id) => projected.some((p) => p.breederId === id)))
      break;
    await delay(200);
  }
  for (const breeder of approved) {
    const rows = projected.filter((row) => row.breederId === breeder.breederId);
    if (rows.length !== 1)
      violations.push(
        `projekce ${breeder.breederId}: ${rows.length} záznamů místo 1`,
      );
    else if (rows[0]!.eventId !== breeder.verificationEvent?.id)
      violations.push(
        `projekce ${breeder.breederId}: eventId ${rows[0]!.eventId} ≠ outbox ${breeder.verificationEvent?.id} (dvě různé události schválení)`,
      );
  }
  const approvedIds = new Set(expectedIds);
  for (const row of projected)
    if (!approvedIds.has(row.breederId))
      violations.push(`projekce ${row.breederId}: chovatel není schválený`);
  return {
    violations,
    approved: approved.length,
    published: approved.filter(
      (breeder) => breeder.verificationEvent?.status === 'published',
    ).length,
    projected: projected.length,
    waitMs,
  };
}
