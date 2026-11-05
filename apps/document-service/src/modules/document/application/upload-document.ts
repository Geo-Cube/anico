import type {
  CreateDocumentInput,
  Document,
  DocumentRepository,
} from '../domain/document.js';

export interface UploadDocumentCommand {
  animalId?: string | undefined;
  stationId?: string | undefined;
  uploadedBy: string;
  documentType: CreateDocumentInput['documentType'];
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export function uploadDocument(repository: DocumentRepository) {
  return async (command: UploadDocumentCommand): Promise<Document> => {
    if (!command.animalId && !command.stationId) {
      throw new Error(
        'Dokument musí být navázán buď na zvíře, nebo na chovatelskou stanici.',
      );
    }

    return repository.create({
      animalId: command.animalId,
      stationId: command.stationId,
      uploadedBy: command.uploadedBy,
      documentType: command.documentType,
      originalFilename: command.originalFilename,
      storagePath: command.storagePath,
      mimeType: command.mimeType,
      sizeBytes: command.sizeBytes,
    });
  };
}

export function getDocument(repository: DocumentRepository) {
  return async (id: string): Promise<Document | null> => {
    if (!id || id.trim().length === 0) {
      throw new Error('ID dokumentu je povinný parametr.');
    }

    return repository.findById(id);
  };
}
