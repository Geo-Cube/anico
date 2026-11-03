import { Router } from 'express';
import {
  AnimalIdSchema,
  AnimalSchema,
  AnimalListSchema,
  AnimalSpeciesSchema,
  CreateAnimalSchema,
  UpdateAnimalSchema,
  ListAnimalsQuerySchema,
  animalBreeds,
} from '@anico/shared-schemas';
import { animalUseCases } from '../application/animals.js';
import type { AnimalRepository } from '../domain/entity.js';

export function AnimalRouter(repository: AnimalRepository) {
  const router = Router();
  const animals = animalUseCases(repository);
  router.get('/breeds/:species', (req, res) => {
    const species = AnimalSpeciesSchema.parse(req.params.species);
    res.json({ species, breeds: animalBreeds(species) });
  });
  router.get('/animals', async (req, res) =>
    res.json(
      AnimalListSchema.parse(
        await animals.list(req.auth, ListAnimalsQuerySchema.parse(req.query)),
      ),
    ),
  );
  router.post('/animals', async (req, res) =>
    res
      .status(201)
      .json(
        AnimalSchema.parse(
          await animals.create(req.auth, CreateAnimalSchema.parse(req.body)),
        ),
      ),
  );
  router.get('/animals/:id', async (req, res) =>
    res.json(
      AnimalSchema.parse(
        await animals.get(req.auth, AnimalIdSchema.parse(req.params.id)),
      ),
    ),
  );
  router.patch('/animals/:id', async (req, res) =>
    res.json(
      AnimalSchema.parse(
        await animals.update(
          req.auth,
          AnimalIdSchema.parse(req.params.id),
          UpdateAnimalSchema.parse(req.body),
        ),
      ),
    ),
  );
  router.delete('/animals/:id', async (req, res) => {
    await animals.remove(req.auth, AnimalIdSchema.parse(req.params.id));
    res.sendStatus(204);
  });
  return router;
}
