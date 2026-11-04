import { Router } from 'express';
import {
  AdminVerificationRequestSchema,
  DecideVerificationRequestSchema,
  ListVerificationRequestsQuerySchema,
  VerificationRequestListSchema,
  VerificationSummarySchema,
} from '@anico/shared-schemas';
import {
  identityOf,
  requireAdmin,
  type IdentityResolver,
} from '../../../shared/http/identity.js';
import { decideVerificationRequest } from '../application/decide-verification-request.js';
import {
  getVerificationRequest,
  getVerificationSummary,
  listVerificationRequests,
  openVerificationCertificate,
} from '../application/verification-queue.js';
import type {
  BreederRepository,
  DecisionNotifier,
  FileStorage,
  WarnLogger,
} from '../domain/ports.js';
import { toAdminVerificationRequest } from './breeder-mapper.js';
import { sendCertificate } from './certificate-response.js';
import { domainErrorResponder } from './domain-errors.js';
import { adminRequestOf } from './responses.js';

export function verificationRequestsRouter(dependencies: {
  repository: BreederRepository;
  files: FileStorage;
  notifier: DecisionNotifier;
  logger: WarnLogger;
  resolveIdentity: IdentityResolver;
  now?: () => Date;
}) {
  const router = Router();
  const { repository: breeders, files } = dependencies;
  router.use(requireAdmin(dependencies.resolveIdentity));

  const list = listVerificationRequests({ breeders, files });
  const summary = getVerificationSummary({ breeders });
  const getOne = getVerificationRequest({ breeders, files });
  const openCertificate = openVerificationCertificate({ breeders, files });
  const decide = decideVerificationRequest({
    breeders,
    notifier: dependencies.notifier,
    logger: dependencies.logger,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const respondWithError = domainErrorResponder(files);
  const adminRequest = adminRequestOf(files);

  // před '/:id', aby 'summary' nebylo považováno za id
  router.get('/summary', async (_req, res) => {
    res.json(VerificationSummarySchema.parse(await summary()));
  });

  router.get('/', async (req, res) => {
    const query = ListVerificationRequestsQuerySchema.safeParse(req.query);
    if (!query.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', issues: query.error.issues });
      return;
    }
    const items = await list(query.data.status);
    res.json(
      VerificationRequestListSchema.parse({
        items: items.map((item) =>
          toAdminVerificationRequest(item.breeder, item.contentType),
        ),
      }),
    );
  });

  router.get('/:id', async (req, res) => {
    try {
      const item = await getOne(String(req.params.id));
      res.json(
        AdminVerificationRequestSchema.parse(
          toAdminVerificationRequest(item.breeder, item.contentType),
        ),
      );
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  });

  router.get('/:id/certificate', async (req, res) => {
    try {
      await sendCertificate(res, await openCertificate(String(req.params.id)));
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  });

  router.post('/:id/decision', async (req, res) => {
    const input = DecideVerificationRequestSchema.safeParse(req.body);
    if (!input.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', issues: input.error.issues });
      return;
    }
    try {
      const breeder = await decide(String(req.params.id), input.data, {
        id: identityOf(res).id,
      });
      res.status(200).json(await adminRequest(breeder));
    } catch (error) {
      if (!(await respondWithError(error, res))) throw error;
    }
  });

  return router;
}
