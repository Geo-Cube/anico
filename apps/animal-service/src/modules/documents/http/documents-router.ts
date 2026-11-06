import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  AnimalDocumentHistorySchema,
  AnimalDocumentIdSchema,
  AnimalDocumentListSchema,
  AnimalDocumentSchema,
  AnimalIdSchema,
  DecideAnimalDocumentSchema,
  DocumentReviewListSchema,
  MAX_DOCUMENTS_PER_SUBMISSION,
  SubmitAnimalDocumentsSchema,
  type AnimalDocument,
} from '@anico/shared-schemas';
import { documentUseCases, type Upload } from '../application/documents.js';
import type { WarnLogger } from '../../animal/application/verified-breeder.js';
import {
  DocumentError,
  MAX_DOCUMENT_FILE_BYTES,
  documentsState,
  type DocumentVersion,
} from '../domain/animal-documents.js';
import type { AnimalDocumentsRepository } from '../domain/ports.js';
import type { BreederVerification } from '../../animal/domain/entity.js';
import type { FileStorage } from '../../../files/file-storage.js';
import {
  UploadError,
  contract,
  multipart,
  storedFileHeaders,
} from '../../../http/files.js';
import { jsonBody } from '../../../http/json-body.js';

export const FILES_FIELD = 'files';
export const FILE_FIELD = 'file';

function toDto(animalId: string, version: DocumentVersion): AnimalDocument {
  return {
    id: version.id,
    animalId,
    documentType: version.documentType,
    versionNumber: version.versionNumber,
    previousDocumentId: version.previousDocumentId,
    isCurrent: version.isCurrent,
    file: {
      fileName: version.file.fileName,
      contentType: version.file.contentType,
      size: version.file.size,
    },
    assessmentStatus: version.assessmentStatus,
    submittedAt: version.submittedAt.toISOString(),
    reviewedBy: version.reviewedBy,
    reviewedAt: version.reviewedAt?.toISOString() ?? null,
    rejectionReason: version.rejectionReason,
  };
}

/** ID verze malými písmeny: schéma přijímá hex v obou velikostech, uložená ID jsou malá. */
const documentIdOf = (req: Request) =>
  AnimalDocumentIdSchema.parse(req.params.documentId).toLowerCase();

type AnimalHandler = (
  req: Request,
  res: Response,
  animalId: string,
) => Promise<void>;

/** Validuje `:animalId` a převádí chyby dokladů na odpověď; 409 nese aktuální verzi řady. */
function animalRoute(handler: AnimalHandler) {
  return async (req: Request, res: Response) => {
    const animalId = AnimalIdSchema.parse(req.params.animalId).toLowerCase();
    try {
      await handler(req, res, animalId);
    } catch (error) {
      if (res.headersSent) throw error;
      if (!(error instanceof DocumentError)) throw error;
      res.status(error.status).json({
        error: error.message,
        ...(error.current ? { current: toDto(animalId, error.current) } : {}),
      });
    }
  };
}

export function DocumentsRouter(dependencies: {
  repository: AnimalDocumentsRepository;
  files: FileStorage;
  verification: BreederVerification;
  newId: () => string;
  logger: WarnLogger;
  now?: () => Date;
}) {
  const router = Router();
  const documents = documentUseCases(dependencies);
  const upload = multer({
    storage: multer.memoryStorage(),
    // prohlížeče posílají název souboru v UTF-8 (výchozí latin1 by rozbilo diakritiku)
    defParamCharset: 'utf8',
    limits: {
      fileSize: MAX_DOCUMENT_FILE_BYTES,
      files: MAX_DOCUMENTS_PER_SUBMISSION,
      fields: MAX_DOCUMENTS_PER_SUBMISSION + 1,
      fieldSize: 1024,
    },
  });
  const parseFiles = multipart(
    upload.array(FILES_FIELD, MAX_DOCUMENTS_PER_SUBMISSION),
  );
  const parseFile = multipart(upload.single(FILE_FIELD));

  router.post(
    '/animals/:animalId/documents',
    animalRoute(async (req, res, animalId) => {
      const created = await documents.submit(req.auth, animalId, async () => {
        await parseFiles(req, res);
        const { documentTypes } = SubmitAnimalDocumentsSchema.parse(req.body);
        const files = (req.files ?? []) as Express.Multer.File[];
        if (files.length === 0 || files.length !== documentTypes.length)
          throw new UploadError(400);
        return files.map((file, index) => ({
          documentType: documentTypes[index]!,
          fileName: file.originalname,
          content: file.buffer,
        }));
      });
      res.status(201).json(
        contract(AnimalDocumentListSchema, {
          animalId,
          documentsState: 'PENDING',
          documents: created.map((version) => toDto(animalId, version)),
        }),
      );
    }),
  );

  router.get(
    '/animals/:animalId/documents',
    animalRoute(async (req, res, animalId) => {
      const current = await documents.list(req.auth, animalId);
      res.json(
        contract(AnimalDocumentListSchema, {
          animalId,
          documentsState: documentsState(current),
          documents: current.map((version) => toDto(animalId, version)),
        }),
      );
    }),
  );

  router.get(
    '/animals/:animalId/documents/:documentId/history',
    animalRoute(async (req, res, animalId) => {
      const documentId = documentIdOf(req);
      const versions = await documents.history(req.auth, animalId, documentId);
      res.json(
        contract(AnimalDocumentHistorySchema, {
          animalId,
          documentType: versions[0]!.documentType,
          versions: versions.map((version) => toDto(animalId, version)),
        }),
      );
    }),
  );

  router.get(
    '/animals/:animalId/documents/:documentId/file',
    animalRoute(async (req, res, animalId) => {
      const documentId = documentIdOf(req);
      const opened = await documents.openFile(req.auth, animalId, documentId);
      res.set(storedFileHeaders(opened.file, opened.size, 'attachment'));
      try {
        await pipeline(opened.stream, res);
      } catch {
        // hlavičky už odešly: status nelze změnit, jen ukončit spojení
        res.destroy();
      }
    }),
  );

  router.post(
    '/animals/:animalId/documents/:documentId/versions',
    animalRoute(async (req, res, animalId) => {
      const documentId = documentIdOf(req);
      const created = await documents.replace(
        req.auth,
        animalId,
        documentId,
        async (): Promise<Upload> => {
          await parseFile(req, res);
          if (!req.file) throw new UploadError(400);
          return { fileName: req.file.originalname, content: req.file.buffer };
        },
      );
      res
        .status(201)
        .json(contract(AnimalDocumentSchema, toDto(animalId, created)));
    }),
  );

  router.post(
    '/animals/:animalId/documents/:documentId/decision',
    jsonBody,
    animalRoute(async (req, res, animalId) => {
      const documentId = documentIdOf(req);
      const decided = await documents.decide(
        req.auth,
        animalId,
        documentId,
        DecideAnimalDocumentSchema.parse(req.body),
      );
      res.json(contract(AnimalDocumentSchema, toDto(animalId, decided)));
    }),
  );

  router.get('/document-reviews', async (req, res) => {
    const queue = await documents.reviewQueue(req.auth);
    res.json(
      contract(DocumentReviewListSchema, {
        items: queue.map(({ version, animal }) => ({
          document: toDto(animal.id, version),
          animal,
        })),
      }),
    );
  });

  return router;
}
