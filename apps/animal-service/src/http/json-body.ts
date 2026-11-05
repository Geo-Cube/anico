import express, { type Request, type Response } from 'express';

/** JSON tělo do 32 KiB; chyby (`Invalid JSON`, 413) mapuje centrální handler. */
export const jsonBody = express.json({ limit: '32kb' });

/** Načte JSON tělo až na pokyn use case, tedy po ověření chovatele a vlastnictví. */
export function readJsonBody(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    jsonBody(req, res, (error?: unknown) =>
      error ? reject(error) : resolve(),
    );
  });
}
