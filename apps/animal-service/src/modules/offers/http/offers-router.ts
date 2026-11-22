import { pipeline } from 'node:stream/promises';
import { Router, type Request } from 'express';
import {
  AnimalPhotoIdSchema,
  CreateInquirySchema,
  CreateOfferSchema,
  MyOfferListSchema,
  OfferDetailSchema,
  OfferIdSchema,
  OfferSchema,
  SubmitInquiryResponseSchema,
  type Offer,
  type OfferDetail,
} from '@anico/shared-schemas';
import {
  offerUseCases,
  type OfferDetailView,
  type OfferView,
} from '../application/offers.js';
import type { FileStorage } from '../../../files/file-storage.js';
import type {
  BreederVerification,
  PhotoResizer,
} from '../../animal/domain/entity.js';
import type { OfferRepository } from '../domain/ports.js';
import {
  PhotoFileQuerySchema,
  contract,
  storedFileHeaders,
} from '../../../http/files.js';
import { readJsonBody } from '../../../http/json-body.js';

/** Odpověď nese jen veřejná pole; `createdBy`/`withdrawnBy` a vlastník službu neopouštějí. */
function toDto({ offer, status, canWithdraw }: OfferView): Offer {
  return {
    id: offer.id,
    animalId: offer.animalId,
    regionId: offer.regionId,
    validFrom: offer.validFrom.toISOString(),
    validTo: offer.validTo?.toISOString() ?? null,
    message: offer.message,
    status,
    canWithdraw,
    createdAt: offer.createdAt.toISOString(),
    withdrawnAt: offer.withdrawnAt?.toISOString() ?? null,
  };
}

/**
 * Whitelist: DTO detailu se skládá pole po poli, nikdy rozbalením entity. Pole, která
 * sem nepatří (vlastník, poptávky, soubory a názvy fotek, doklady, kontakty), se tak
 * nemohou dostat do odpovědi ani po rozšíření záznamu.
 */
function toDetailDto({
  offer,
  status,
  animal,
  verification,
  canSendInquiry,
  inquiryUnavailableReason,
}: OfferDetailView): OfferDetail {
  return {
    id: offer.id,
    animalId: offer.animalId,
    regionId: offer.regionId,
    validFrom: offer.validFrom.toISOString(),
    validTo: offer.validTo?.toISOString() ?? null,
    message: offer.message,
    status,
    animal: {
      name: animal.name,
      species: animal.species,
      breedId: animal.breedId,
      sex: animal.sex,
      birthDate: animal.birthDate,
      coatColor: animal.coatColor,
      weightKg: animal.weightKg,
      city: animal.city,
      pedigreeNumber: animal.pedigreeNumber,
      microchipNumber: animal.microchipNumber,
      description: animal.description,
      photos: animal.photos.map((photo) => ({
        id: photo.id,
        isPrimary: photo.isPrimary,
      })),
    },
    verification: {
      verified: verification.verified,
      documentTypes: [...verification.documentTypes],
    },
    canSendInquiry,
    inquiryUnavailableReason,
  };
}

const PHOTO_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

/** ID nabídky malými písmeny: schéma přijímá hex v obou velikostech, uložená ID jsou malá. */
const offerIdOf = (req: Request) =>
  OfferIdSchema.parse(req.params.offerId).toLowerCase();

export function OffersRouter(dependencies: {
  repository: OfferRepository;
  photos: FileStorage;
  photoVariants: FileStorage;
  resizer: PhotoResizer;
  verification: BreederVerification;
  newId: () => string;
  now?: () => Date;
}) {
  const router = Router();
  const offers = offerUseCases(dependencies);

  router.post('/offers', async (req, res) => {
    const created = await offers.create(req.auth, async () => {
      await readJsonBody(req, res);
      return CreateOfferSchema.parse(req.body);
    });
    req.log.info(
      {
        event: 'offer.created',
        offerId: created.offer.id,
        animalId: created.offer.animalId,
      },
      'Offer created',
    );
    res.status(201).json(contract(OfferSchema, toDto(created)));
  });

  router.get('/offers/mine', async (req, res) => {
    const mine = await offers.listMine(req.auth);
    res.json(
      contract(MyOfferListSchema, {
        items: mine.map((view) => ({
          ...toDto(view),
          animal: view.animal,
        })),
        nextCursor: null,
      }),
    );
  });

  // čtení se nelogují (jako ostatní GET routy)
  router.get('/offers/:offerId', async (req, res) => {
    const view = await offers.detail(req.auth, offerIdOf(req));
    res.json(contract(OfferDetailSchema, toDetailDto(view)));
  });

  router.get('/offers/:offerId/photos/:photoId/file', async (req, res) => {
    const offerId = offerIdOf(req);
    const photoId = AnimalPhotoIdSchema.parse(req.params.photoId).toLowerCase();
    const { size } = PhotoFileQuerySchema.parse(req.query);
    const opened = await offers.openPhoto(req.auth, offerId, photoId, size);
    // Původní název souboru patří vlastníkovi zvířete; cizímu chovateli se neprozrazuje.
    res.set(
      storedFileHeaders(
        {
          fileName: `${photoId}.${PHOTO_EXTENSIONS[opened.file.contentType]}`,
          contentType: opened.file.contentType,
        },
        opened.size,
        'inline',
      ),
    );
    try {
      await pipeline(opened.stream, res);
    } catch {
      // hlavičky už odešly: status nelze změnit, jen ukončit spojení
      res.destroy();
    }
  });

  // tělo se nečte: stažení nemá jiné vstupy než ID v cestě
  router.post('/offers/:offerId/withdraw', async (req, res) => {
    const withdrawn = await offers.withdraw(req.auth, offerIdOf(req));
    req.log.info(
      {
        event: 'offer.withdrawn',
        offerId: withdrawn.offer.id,
        animalId: withdrawn.offer.animalId,
      },
      'Offer withdrawn',
    );
    res.json(contract(OfferSchema, toDto(withdrawn)));
  });

  router.post('/offers/:offerId/inquiries', async (req, res) => {
    const offerId = offerIdOf(req);
    const submitted = await offers.submitInquiry(
      req.auth,
      offerId,
      async () => {
        await readJsonBody(req, res);
        return CreateInquirySchema.parse(req.body);
      },
    );
    req.log.info(
      {
        event: 'inquiry.created',
        inquiryId: submitted.inquiry.id,
        offerId: submitted.inquiry.offerId,
      },
      'Inquiry created',
    );
    res.status(201).json(
      contract(SubmitInquiryResponseSchema, {
        id: submitted.inquiry.id,
        offerId: submitted.inquiry.offerId,
        message: submitted.inquiry.message,
        status: submitted.inquiry.status,
        submittedAt: submitted.inquiry.submittedAt.toISOString(),
        animalName: submitted.animalName,
        regionId: submitted.regionId,
      }),
    );
  });

  return router;
}
