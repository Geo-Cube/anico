import { Router, type Request } from 'express';
import {
  CreateInquirySchema,
  CreateOfferSchema,
  MyOfferListSchema,
  OfferIdSchema,
  OfferSchema,
  SubmitInquiryResponseSchema,
  type Offer,
} from '@anico/shared-schemas';
import { offerUseCases, type OfferView } from '../application/offers.js';
import type { BreederVerification } from '../../animal/domain/entity.js';
import type { OfferRepository } from '../domain/ports.js';
import { contract } from '../../../http/files.js';
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

/** ID nabídky malými písmeny: schéma přijímá hex v obou velikostech, uložená ID jsou malá. */
const offerIdOf = (req: Request) =>
  OfferIdSchema.parse(req.params.offerId).toLowerCase();

export function OffersRouter(dependencies: {
  repository: OfferRepository;
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
