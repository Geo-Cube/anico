import { Schema, Types, type Connection, type Model } from 'mongoose';
import {
  AnimalDocumentTypeSchema,
  AnimalSexSchema,
  AnimalSpeciesSchema,
  AssessmentStatusSchema,
  type Animal,
  type AnimalDocumentType,
  type AssessmentStatus,
} from '@anico/shared-schemas';

/** Verze dokladu vnořená ve zvířeti (UC-03, ADR-0005). */
export interface StoredDocumentVersion {
  _id: Types.ObjectId;
  documentType: AnimalDocumentType;
  versionNumber: number;
  previousDocumentId: Types.ObjectId | null;
  isCurrent: boolean;
  file: {
    fileName: string;
    fileReference: string;
    contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
    size: number;
  };
  assessmentStatus: AssessmentStatus;
  submittedAt: Date;
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export interface StoredAnimal {
  ownerUserId: string;
  name: string;
  species: Animal['species'];
  breedId: string;
  sex: Animal['sex'];
  birthDate: string | null;
  documents: StoredDocumentVersion[];
  /** Optimistická kontrola zápisů do `documents`; mění ji každé podání i rozhodnutí. */
  documentsRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Projekce zvířete bez dokladů pro CRUD zvířat. */
export const WITHOUT_DOCUMENTS = { documents: 0, documentsRevision: 0 };

const documentVersionSchema = new Schema<StoredDocumentVersion>(
  {
    documentType: {
      type: String,
      required: true,
      enum: AnimalDocumentTypeSchema.options,
    },
    versionNumber: { type: Number, required: true, min: 1 },
    previousDocumentId: { type: Schema.Types.ObjectId, default: null },
    isCurrent: { type: Boolean, required: true },
    file: {
      _id: false,
      fileName: { type: String, required: true, maxlength: 150 },
      fileReference: { type: String, required: true },
      contentType: {
        type: String,
        required: true,
        enum: ['application/pdf', 'image/jpeg', 'image/png'],
      },
      size: { type: Number, required: true, min: 1 },
    },
    assessmentStatus: {
      type: String,
      required: true,
      enum: AssessmentStatusSchema.options,
    },
    submittedAt: { type: Date, required: true },
    submittedBy: { type: String, required: true, maxlength: 36 },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },
  },
  { strict: 'throw' },
);

export function animalModel(connection: Connection): Model<StoredAnimal> {
  const existing = connection.models.Animal as Model<StoredAnimal> | undefined;
  if (existing) return existing;
  const schema = new Schema<StoredAnimal>(
    {
      ownerUserId: { type: String, required: true, maxlength: 36 },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      species: {
        type: String,
        required: true,
        enum: AnimalSpeciesSchema.options,
      },
      breedId: { type: String, required: true, maxlength: 160 },
      sex: { type: String, required: true, enum: AnimalSexSchema.options },
      birthDate: { type: String, default: null },
      documents: { type: [documentVersionSchema], default: [] },
      documentsRevision: { type: Number, default: 0 },
    },
    {
      timestamps: true,
      versionKey: false,
      autoIndex: false,
      autoCreate: false,
      strict: 'throw',
    },
  );
  return connection.model<StoredAnimal>('Animal', schema, 'animals');
}
