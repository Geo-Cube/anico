import { isValidObjectId, Types, type Connection } from 'mongoose';
import type { Animal } from '@anico/shared-schemas';
import {
  animalModel,
  type StoredDocumentVersion,
} from '../../animal/infrastructure/animal-model.js';
import type { DocumentVersion } from '../domain/animal-documents.js';
import type { AnimalDocumentsRepository } from '../domain/ports.js';

function toDomain(stored: StoredDocumentVersion): DocumentVersion {
  return {
    id: stored._id.toString(),
    documentType: stored.documentType,
    versionNumber: stored.versionNumber,
    previousDocumentId: stored.previousDocumentId?.toString() ?? null,
    isCurrent: stored.isCurrent,
    file: {
      fileName: stored.file.fileName,
      fileReference: stored.file.fileReference,
      contentType: stored.file.contentType,
      size: stored.file.size,
    },
    assessmentStatus: stored.assessmentStatus,
    submittedAt: stored.submittedAt,
    submittedBy: stored.submittedBy,
    reviewedBy: stored.reviewedBy,
    reviewedAt: stored.reviewedAt,
    rejectionReason: stored.rejectionReason,
  };
}

function toStored(version: DocumentVersion): StoredDocumentVersion {
  return {
    ...version,
    _id: new Types.ObjectId(version.id),
    previousDocumentId: version.previousDocumentId
      ? new Types.ObjectId(version.previousDocumentId)
      : null,
  };
}

/** Doklady jsou pole `documents` v dokumentu zvířete; každý zápis je jeden atomický update (ADR-0005). */
export function mongooseDocumentsRepository(
  connection: Connection,
): AnimalDocumentsRepository {
  const model = animalModel(connection);
  return {
    async load(animalId) {
      if (!isValidObjectId(animalId)) return null;
      const doc = await model
        .findById(animalId, {
          ownerUserId: 1,
          documents: 1,
          documentsRevision: 1,
        })
        .lean();
      if (!doc) return null;
      return {
        animalId,
        ownerUserId: doc.ownerUserId,
        revision: doc.documentsRevision ?? 0,
        versions: (doc.documents ?? []).map(toDomain),
      };
    },

    async saveVersions(animalId, ownerUserId, expectedRevision, versions) {
      const result = await model.updateOne(
        {
          _id: animalId,
          ownerUserId,
          // dokumenty před zavedením dokladů pole nemají; revize 0 = žádný zápis dokladů
          ...(expectedRevision === 0
            ? { documentsRevision: { $in: [0, null] } }
            : { documentsRevision: expectedRevision }),
        },
        {
          $set: {
            documents: versions.map(toStored),
            documentsRevision: expectedRevision + 1,
          },
        },
        { runValidators: true, timestamps: false },
      );
      return result.modifiedCount === 1;
    },

    async decide(animalId, documentId, decision) {
      if (!isValidObjectId(animalId) || !isValidObjectId(documentId))
        return null;
      const doc = await model
        .findOneAndUpdate(
          {
            _id: animalId,
            documents: {
              $elemMatch: {
                _id: new Types.ObjectId(documentId),
                isCurrent: true,
                assessmentStatus: 'PENDING',
              },
            },
          },
          {
            $set: {
              'documents.$.assessmentStatus': decision.assessmentStatus,
              'documents.$.reviewedBy': decision.reviewedBy,
              'documents.$.reviewedAt': decision.reviewedAt,
              'documents.$.rejectionReason': decision.rejectionReason,
            },
            // souběžné podání vychází ze starší revize a rozhodnutí tak nepřepíše
            $inc: { documentsRevision: 1 },
          },
          {
            new: true,
            timestamps: false,
            projection: { documents: { $elemMatch: { _id: documentId } } },
          },
        )
        .lean();
      const decided = doc?.documents?.[0];
      return decided ? toDomain(decided) : null;
    },

    async reviewQueue(limit) {
      const rows = await model.aggregate<{
        _id: Types.ObjectId;
        ownerUserId: string;
        name: string;
        species: Animal['species'];
        breedId: string;
        sex: Animal['sex'];
        document: StoredDocumentVersion;
      }>([
        {
          $match: {
            documents: {
              $elemMatch: { isCurrent: true, assessmentStatus: 'PENDING' },
            },
          },
        },
        { $unwind: '$documents' },
        {
          $match: {
            'documents.isCurrent': true,
            'documents.assessmentStatus': 'PENDING',
          },
        },
        { $sort: { 'documents.submittedAt': 1, 'documents._id': 1 } },
        { $limit: limit },
        {
          $project: {
            ownerUserId: 1,
            name: 1,
            species: 1,
            breedId: 1,
            sex: 1,
            document: '$documents',
          },
        },
      ]);
      return rows.map((row) => ({
        version: toDomain(row.document),
        animal: {
          id: row._id.toString(),
          ownerUserId: row.ownerUserId,
          name: row.name,
          species: row.species,
          breedId: row.breedId,
          sex: row.sex,
        },
      }));
    },
  };
}
