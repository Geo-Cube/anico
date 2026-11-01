import { CreateNamedRecordSchema, NamedRecordSchema } from '@anico/shared-schemas';
import { Router } from 'express';
import { create__MODULE_PASCAL__, list__MODULE_PASCAL__ } from '../application/records.js';
import type { __MODULE_PASCAL__Repository } from '../domain/entity.js';
export function __MODULE_PASCAL__Router(repository: __MODULE_PASCAL__Repository) {
  const router = Router();
  const create = create__MODULE_PASCAL__(repository);
  const list = list__MODULE_PASCAL__(repository);
  router.get('/', async (_req, res) => res.json(NamedRecordSchema.array().parse(await list())));
  router.post('/', async (req, res) => {
    const input = CreateNamedRecordSchema.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: 'Validation failed', issues: input.error.issues }); return; }
    res.status(201).json(NamedRecordSchema.parse(await create(input.data)));
  });
  return router;
}
