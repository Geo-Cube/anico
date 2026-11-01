import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { DocumentRepository } from '../domain/document.js';
import { uploadDocument, getDocument } from '../application/upload-document.js';
import { documentUploadMiddleware } from '../infrastructure/upload-storage.js';

import mongoose from 'mongoose';

const UploadDocumentBodySchema = z.object({
  animalId: z.string().min(1, 'animalId je povinné pole'),
  documentType: z.enum(['PEDIGREE', 'VET_REPORT', 'BREEDING_LICENSE']),
});

export function documentRouter(repository: DocumentRepository) {
  const router = Router();
  const executeUpload = uploadDocument(repository);
  const executeGet = getDocument(repository);

  router.post(
    '/',
    documentUploadMiddleware.single('file'),
    async (req, res) => {
      if (!req.file) {
        res
          .status(400)
          .json({ error: 'Nebyl přiložen žádný soubor k nahrání.' });
        return;
      }

      const input = UploadDocumentBodySchema.safeParse(req.body);
      if (!input.success) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(400).json({
          error: 'Validation failed',
          issues: input.error.issues,
        });
        return;
      }

      //const uploadedBy = (req as any).user?.id || '654321654321654321654321';

      const uploadedBy =
        (req as any).user?.id || new mongoose.Types.ObjectId().toString();

      try {
        const result = await executeUpload({
          animalId: input.data.animalId,
          documentType: input.data.documentType,
          uploadedBy,
          originalFilename: req.file.originalname,
          storagePath: req.file.path,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        });

        res.status(201).json({
          message: 'Dokument byl úspěšně nahrán.',
          document: result,
        });
      } catch (err: any) {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res
          .status(500)
          .json({ error: 'Interní chyba při ukládání dokumentu.' });
      }
    },
  );

  router.get('/:id', async (req, res) => {
    const doc = await executeGet(req.params.id);
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
