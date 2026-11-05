export type DocumentType =
  'PEDIGREE' | 'VET_REPORT' | 'BREEDING_LICENSE' | 'STATION_REGISTRATION';

export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Document {
  id: string;
  animalId?: string | undefined;
  stationId?: string | undefined;
  uploadedBy: string;
  documentType: DocumentType;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export interface CreateDocumentInput {
  animalId?: string | undefined;
  stationId?: string | undefined;
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
