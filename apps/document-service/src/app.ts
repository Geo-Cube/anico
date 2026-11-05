import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import mongoose from 'mongoose';
import { documentRouter } from './modules/document/http/document-router.js';
import { mongooseDocumentRepository } from './modules/document/infrastructure/mongoose-document-repository.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'document-service' });
  });

  const documentRepository = mongooseDocumentRepository(mongoose.connection);
  app.use('/api/documents', documentRouter(documentRepository));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      error: 'Interní chyba serveru',
      message: err.message,
    });
  });

  return app;
}
