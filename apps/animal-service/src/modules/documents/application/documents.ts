import { AuthorizationError, type Identity, type Role } from '@anico/auth';
import type {
  AnimalDocumentType,
  DecideAnimalDocumentInput,
} from '@anico/shared-schemas';
import {
  DocumentError,
  assertReplaceable,
  currentVersionOf,
  documentNotFound,
  historyOf,
  planSubmission,
  type AnimalDocuments,
  type DocumentVersion,
  type NewVersionInput,
} from '../domain/animal-documents.js';
import {
  detectFileContentType,
  sanitizeFileName,
} from '../../../files/file-content.js';
import type { FileStorage } from '../../../files/file-storage.js';
import type { BreederVerification } from '../../animal/domain/entity.js';
import {
  verifiedBreeder,
  type WarnLogger,
} from '../../animal/application/verified-breeder.js';
import type { AnimalDocumentsRepository } from '../domain/ports.js';

/** Role posuzovatele dokladů (stejné jako u UC-01). */
const REVIEWER_ROLES: readonly Role[] = ['admin', 'owner'];
const QUEUE_LIMIT = 500;
const WRITE_ATTEMPTS = 3;

export interface Upload {
  fileName: string;
  content: Buffer;
}

function requireActor(actor: Identity | undefined): Identity {
  if (!actor) throw new AuthorizationError(401);
  return actor;
}

/** Interní obálka: zápis mohl proběhnout, uložené soubory se proto nesmí uklidit. */
class UnknownWriteOutcome extends Error {
  constructor(cause: unknown) {
    super('Document write outcome unknown', { cause });
  }
}

const isReviewer = (identity: Identity) =>
  REVIEWER_ROLES.some((role) => identity.roles.includes(role));

export function documentUseCases(dependencies: {
  repository: AnimalDocumentsRepository;
  files: FileStorage;
  verification: BreederVerification;
  newId: () => string;
  logger: WarnLogger;
  now?: () => Date;
}) {
  const { repository, files, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const breeder = verifiedBreeder(dependencies.verification);

  /** Vlastník zvířete s ověřeným účtem; cizí i neexistující zvíře je 404. */
  async function ownedAnimal(
    actor: Identity | undefined,
    identityToken: string | undefined,
    animalId: string,
  ) {
    const identity = await breeder(actor, identityToken);
    const documents = await repository.load(animalId);
    if (!documents || documents.ownerUserId !== identity.userId)
      throw new DocumentError(404, 'Animal not found');
    return { identity, documents };
  }

  /** Čtení: posuzovatel bez dalších podmínek, jinak ověřený vlastník. */
  async function readableAnimal(
    actor: Identity | undefined,
    identityToken: string | undefined,
    animalId: string,
  ): Promise<AnimalDocuments> {
    const identity = requireActor(actor);
    if (!isReviewer(identity))
      return (await ownedAnimal(identity, identityToken, animalId)).documents;
    const documents = await repository.load(animalId);
    if (!documents) throw new DocumentError(404, 'Animal not found');
    return documents;
  }

  /** Nic se neuloží, dokud všechny soubory neprojdou kontrolou formátu. */
  async function storeFiles(
    uploads: readonly (Upload & { documentType: AnimalDocumentType })[],
  ): Promise<NewVersionInput[]> {
    const checked = uploads.map((upload) => {
      const contentType = detectFileContentType(upload.content);
      if (!contentType)
        throw new DocumentError(
          415,
          'Document must be a PDF, JPEG or PNG file',
        );
      return { ...upload, contentType };
    });
    const stored: NewVersionInput[] = [];
    try {
      for (const upload of checked) {
        const fileName = sanitizeFileName(upload.fileName, 'document');
        const fileReference = await files.save({
          content: upload.content,
          fileName,
          contentType: upload.contentType,
        });
        stored.push({
          documentType: upload.documentType,
          file: {
            fileName,
            fileReference,
            contentType: upload.contentType,
            size: upload.content.length,
          },
        });
      }
      return stored;
    } catch (error) {
      await removeFiles(stored);
      throw error;
    }
  }

  async function removeFiles(stored: readonly NewVersionInput[]) {
    for (const { file } of stored) {
      try {
        await files.delete(file.fileReference);
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : 'unknown' },
          'Orphan document file cleanup failed',
        );
      }
    }
  }

  /**
   * Výjimka ze `saveVersions` nemusí znamenat neprovedený zápis (ztracené potvrzení, timeout).
   * Uložené verze se proto dohledají; chybí-li, soubory se nemažou, protože zápis může ještě
   * doběhnout. Osiřelý soubor je neškodný, smazaný soubor uložené verze je ztráta dat.
   */
  async function reconcileUnknownWrite(
    animalId: string,
    created: readonly DocumentVersion[],
    stored: readonly NewVersionInput[],
  ): Promise<DocumentVersion[] | null> {
    try {
      const ids = new Set(
        (await repository.load(animalId))?.versions.map(({ id }) => id),
      );
      if (created.every(({ id }) => ids.has(id))) return [...created];
    } catch {
      // stav nelze zjistit: stejně jako u chybějících verzí soubory ponechat
    }
    logger.warn(
      {
        animalId,
        fileReferences: stored.map(({ file }) => file.fileReference),
      },
      'Document write outcome unknown; files kept for deferred cleanup',
    );
    return null;
  }

  /**
   * Zapíše novou podobu verzí optimisticky (ADR-0005): při souběžné změně se plán sestaví
   * znovu nad čerstvým stavem. Soubory se mažou jen tehdy, když jisté je, že je žádný zápis
   * nepoužil (odmítnutí před zápisem nebo nepřijatá revize).
   */
  async function writeVersions(
    identity: Identity,
    animalId: string,
    stored: NewVersionInput[],
    plan: (versions: DocumentVersion[]) => NewVersionInput[],
  ): Promise<DocumentVersion[]> {
    try {
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
        const documents = await repository.load(animalId);
        if (!documents || documents.ownerUserId !== identity.userId)
          throw new DocumentError(404, 'Animal not found');
        const next = planSubmission(
          documents.versions,
          plan(documents.versions),
          {
            id: dependencies.newId,
            now: now(),
            submittedBy: identity.userId,
          },
        );
        let saved: boolean;
        try {
          saved = await repository.saveVersions(
            animalId,
            identity.userId,
            documents.revision,
            next.versions,
          );
        } catch (error) {
          const persisted = await reconcileUnknownWrite(
            animalId,
            next.created,
            stored,
          );
          if (persisted) return persisted;
          throw new UnknownWriteOutcome(error);
        }
        if (saved) return next.created;
      }
      throw new DocumentError(409, 'Documents changed concurrently; retry');
    } catch (error) {
      if (error instanceof UnknownWriteOutcome) throw error.cause;
      await removeFiles(stored);
      throw error;
    }
  }

  return {
    /** UC-03/1: každý soubor je samostatný doklad; celé podání se uloží jedním zápisem. */
    async submit(
      actor: Identity | undefined,
      identityToken: string | undefined,
      animalId: string,
      readUploads: () => Promise<
        (Upload & { documentType: AnimalDocumentType })[]
      >,
    ): Promise<DocumentVersion[]> {
      const { identity } = await ownedAnimal(actor, identityToken, animalId);
      const stored = await storeFiles(await readUploads());
      return writeVersions(identity, animalId, stored, () => stored);
    },

    /** UC-03/4–5: nová verze aktuálního zamítnutého dokladu, každá verze jen jednou. */
    async replace(
      actor: Identity | undefined,
      identityToken: string | undefined,
      animalId: string,
      documentId: string,
      readUpload: () => Promise<Upload>,
    ): Promise<DocumentVersion> {
      const { identity, documents } = await ownedAnimal(
        actor,
        identityToken,
        animalId,
      );
      const { documentType } = assertReplaceable(
        documents.versions,
        documentId,
      );
      const stored = await storeFiles([
        { ...(await readUpload()), documentType },
      ]);
      const [created] = await writeVersions(
        identity,
        animalId,
        stored,
        (versions) => {
          assertReplaceable(versions, documentId);
          return stored;
        },
      );
      return created!;
    },

    async list(
      actor: Identity | undefined,
      identityToken: string | undefined,
      animalId: string,
    ) {
      const documents = await readableAnimal(actor, identityToken, animalId);
      return documents.versions.filter((version) => version.isCurrent);
    },

    async history(
      actor: Identity | undefined,
      identityToken: string | undefined,
      animalId: string,
      documentId: string,
    ) {
      const documents = await readableAnimal(actor, identityToken, animalId);
      return historyOf(documents.versions, documentId);
    },

    /** Stažení libovolné verze (i historické) po kontrole oprávnění. */
    async openFile(
      actor: Identity | undefined,
      identityToken: string | undefined,
      animalId: string,
      documentId: string,
    ) {
      const documents = await readableAnimal(actor, identityToken, animalId);
      const version = documents.versions.find(({ id }) => id === documentId);
      if (!version) throw documentNotFound();
      const opened = await files.open(version.file.fileReference);
      if (!opened) throw new Error('Stored document file is missing');
      return { ...opened, file: version.file };
    },

    /** UC-03/2–3: rozhodnutí jen o aktuální `PENDING` verzi, atomicky (A4). */
    async decide(
      actor: Identity | undefined,
      animalId: string,
      documentId: string,
      input: DecideAnimalDocumentInput,
    ): Promise<DocumentVersion> {
      const identity = requireActor(actor);
      if (!isReviewer(identity)) throw new AuthorizationError(403);
      const decided = await repository.decide(animalId, documentId, {
        assessmentStatus: input.decision,
        reviewedBy: identity.userId,
        reviewedAt: now(),
        rejectionReason:
          input.decision === 'REJECTED' ? input.rejectionReason : null,
      });
      if (decided) return decided;
      const versions = (await repository.load(animalId))?.versions ?? [];
      const target = versions.find(({ id }) => id === documentId);
      if (!target) throw documentNotFound();
      throw new DocumentError(
        409,
        target.isCurrent
          ? 'Document already decided'
          : 'Document version is not current',
        currentVersionOf(versions, target.documentType),
      );
    },

    async reviewQueue(actor: Identity | undefined) {
      const identity = requireActor(actor);
      if (!isReviewer(identity)) throw new AuthorizationError(403);
      return repository.reviewQueue(QUEUE_LIMIT);
    },
  };
}
