import type {
  CreateDocumentInput,
  Document,
  DocumentRepository,
} from '../domain/document.js';

export function uploadDocument(repository: DocumentRepository) {
  return async (input: CreateDocumentInput): Promise<Document> => {
    return repository.create(input);
  };
}

export function getDocument(repository: DocumentRepository) {
  return async (id: string): Promise<Document | null> => {
    return repository.findById(id);
  };
}
