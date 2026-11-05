import 'multer';
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { uploadDocumentSchema } from '@anico/shared-schemas';
import type { DocumentRepository } from '../domain/document.js';
import { uploadDocument, getDocument } from '../application/upload-document.js';
import { documentUploadMiddleware } from '../infrastructure/upload-storage.js';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

export function documentRouter(repository: DocumentRepository): Router {
  const router = Router();
  const executeUpload = uploadDocument(repository);
  const executeGet = getDocument(repository);

  router.post(
    '/',
    documentUploadMiddleware.single('file'),
    async (req: Request, res: Response): Promise<void> => {
      const fileReq = req as MulterRequest;

      if (!fileReq.file) {
        res
          .status(400)
          .json({ error: 'Nebyl přiložen žádný soubor k nahrání.' });
        return;
      }

      const input = uploadDocumentSchema.safeParse(fileReq.body);
      if (!input.success) {
        if (fs.existsSync(fileReq.file.path)) {
          fs.unlinkSync(fileReq.file.path);
        }
        res.status(400).json({
          error: 'Validation failed',
          issues: input.error.issues,
        });
        return;
      }

      const uploadedBy =
        (fileReq as any).user?.id ||
        input.data.uploadedBy ||
        new mongoose.Types.ObjectId().toString();

      try {
        const result = await executeUpload({
          animalId: input.data.animalId,
          stationId: input.data.stationId,
          documentType: input.data.documentType,
          uploadedBy,
          originalFilename: fileReq.file.originalname,
          storagePath: fileReq.file.path,
          mimeType: fileReq.file.mimetype,
          sizeBytes: fileReq.file.size,
        });

        res.status(201).json({
          message: 'Dokument byl úspěšně nahrán.',
          document: result,
        });
      } catch (_err: unknown) {
        if (fileReq.file && fs.existsSync(fileReq.file.path)) {
          fs.unlinkSync(fileReq.file.path);
        }
        res
          .status(500)
          .json({ error: 'Interní chyba při ukládání dokumentu.' });
      }
    },
  );

  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params.id;
    const documentId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!documentId || typeof documentId !== 'string') {
      res.status(400).json({ error: 'Chybí ID dokumentu.' });
      return;
    }

    const doc = await executeGet(documentId);
    if (!doc) {
      res.status(404).json({ error: 'Dokument nebyl nalezen.' });
      return;
    }

    const resolved = path.resolve(doc.storagePath);
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Fyzický soubor na disku neexistuje.' });
      return;
    }

    res.sendFile(resolved);
  });

  return router;
}
