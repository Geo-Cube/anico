import { Schema, Types, type Connection, type Model } from 'mongoose';
import {
  AnimalDocumentTypeSchema,
  AnimalSexSchema,
  AnimalSpeciesSchema,
  AssessmentStatusSchema,
  type Animal,
  type AnimalDocumentType,
  type AnimalPhotoSize,
  type AssessmentStatus,
} from '@anico/shared-schemas';
import type { PhotoContentType } from '../domain/entity.js';

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

/**
 * Fotografie vnořená ve zvířeti (UC-02/3); originál je v GridFS bucketu `animalPhotos`,
 * zmenšeniny v `animalPhotoVariants`. Fotografie z doby před zmenšeninami mají `variants: null`.
 */
export interface StoredPhoto {
  _id: Types.ObjectId;
  file: {
    fileName: string;
    fileReference: string;
    contentType: PhotoContentType;
    size: number;
  };
  variants?: Record<AnimalPhotoSize, StoredPhotoVariant> | null;
  isPrimary: boolean;
}
export interface StoredPhotoVariant {
  fileReference: string;
  size: number;
}

export interface StoredAnimal {
  ownerUserId: string;
  name: string;
  species: Animal['species'];
  breedId: string;
  sex: Animal['sex'];
  birthDate: string | null;
  coatColor: string | null;
  weightKg: number | null;
  city: string | null;
  pedigreeNumber: string | null;
  microchipNumber: string | null;
  description: string | null;
  photos: StoredPhoto[];
  /** Optimistická kontrola společného zápisu profilu a fotografií (UC-02/4). */
  profileRevision: number;
  documents: StoredDocumentVersion[];
  /** Optimistická kontrola zápisů do `documents`; mění ji každé podání i rozhodnutí. */
  documentsRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Projekce pro CRUD zvířat: z dokladů jen `isCurrent` a `assessmentStatus` pro odvozený
 * stav dokladů (UC-03/7); soubory, důvody ani posouzení se nečtou.
 */
export const PROFILE_WITH_DOCUMENT_STATUSES = {
  'documents._id': 0,
  'documents.documentType': 0,
  'documents.versionNumber': 0,
  'documents.previousDocumentId': 0,
  'documents.file': 0,
  'documents.submittedAt': 0,
  'documents.submittedBy': 0,
  'documents.reviewedBy': 0,
  'documents.reviewedAt': 0,
  'documents.rejectionReason': 0,
  documentsRevision: 0,
};

const variantSchema = {
  _id: false,
  fileReference: { type: String, required: true },
  size: { type: Number, required: true, min: 1 },
};

const photoSchema = new Schema<StoredPhoto>(
  {
    file: {
      _id: false,
      fileName: { type: String, required: true, maxlength: 150 },
      fileReference: { type: String, required: true },
      contentType: {
        type: String,
        required: true,
        enum: ['image/jpeg', 'image/png'],
      },
      size: { type: Number, required: true, min: 1 },
    },
    variants: {
      type: new Schema(
        { thumbnail: variantSchema, preview: variantSchema },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    isPrimary: { type: Boolean, required: true },
  },
  { strict: 'throw' },
);

const optionalText = (maxlength: number) => ({
  type: String,
  default: null,
  trim: true,
  maxlength,
});

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
      name: {
        type: String,
        required: true,
        trim: true,
        minlength: 1,
        maxlength: 120,
      },
      species: {
        type: String,
        required: true,
        enum: AnimalSpeciesSchema.options,
      },
      breedId: { type: String, required: true, maxlength: 160 },
      sex: { type: String, required: true, enum: AnimalSexSchema.options },
      birthDate: { type: String, default: null },
      coatColor: optionalText(60),
      weightKg: {
        type: Number,
        default: null,
        validate: (value: number | null) => value === null || value > 0,
        max: 2000,
      },
      city: optionalText(120),
      pedigreeNumber: optionalText(60),
      // celý zápis bez ořezávání (anico-domain §4)
      microchipNumber: { type: String, default: null, maxlength: 64 },
      description: optionalText(2000),
      photos: { type: [photoSchema], default: [] },
      profileRevision: { type: Number, default: 0 },
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
