export type DocumentType = 'PEDIGREE' | 'VET_REPORT' | 'BREEDING_LICENSE';
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Document {
  id: string;
  animalId: string;
  uploadedBy: string;
  documentType: DocumentType;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateDocumentInput {
  animalId: string;
  uploadedBy: string;
  documentType: DocumentType;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<Document>;
  findById(id: string): Promise<Document | null>;
  findByAnimalId(animalId: string): Promise<Document[]>;
}
