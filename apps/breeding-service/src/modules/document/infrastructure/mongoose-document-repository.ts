import { Schema, type Connection } from 'mongoose';
import type {
  CreateDocumentInput,
  Document,
  DocumentRepository,
  DocumentStatus,
  DocumentType,
} from '../domain/document.js';

interface DocumentRecord {
  animalId: string;
  uploadedBy: string;
  documentType: DocumentType;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function mongooseDocumentRepository(
  connection: Connection,
): DocumentRepository {
  const schema = new Schema<DocumentRecord>(
    {
      animalId: { type: String, required: true },
      uploadedBy: { type: String, required: true },
      documentType: {
        type: String,
        enum: ['PEDIGREE', 'VET_REPORT', 'BREEDING_LICENSE'],
        required: true,
      },
      originalFilename: { type: String, required: true, trim: true },
      storagePath: { type: String, required: true },
      mimeType: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
      status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING',
      },
    },
    { timestamps: true, versionKey: false },
  );

  const model = connection.model<DocumentRecord>('Document', schema);

  return {
    async create(input: CreateDocumentInput): Promise<Document> {
      const record = await model.create({
        ...input,
        status: 'PENDING',
      });

      return {
        id: record._id.toString(),
        animalId: record.animalId,
        uploadedBy: record.uploadedBy,
        documentType: record.documentType,
        originalFilename: record.originalFilename,
        storagePath: record.storagePath,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    },

    async findById(id: string): Promise<Document | null> {
      const record = await model.findById(id).exec();
      if (!record) return null;

      return {
        id: record._id.toString(),
        animalId: record.animalId,
        uploadedBy: record.uploadedBy,
        documentType: record.documentType,
        originalFilename: record.originalFilename,
        storagePath: record.storagePath,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    },

    async findByAnimalId(animalId: string): Promise<Document[]> {
      const records = await model.find({ animalId }).exec();
      return records.map((record) => ({
        id: record._id.toString(),
        animalId: record.animalId,
        uploadedBy: record.uploadedBy,
        documentType: record.documentType,
        originalFilename: record.originalFilename,
        storagePath: record.storagePath,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    },
  };
}
