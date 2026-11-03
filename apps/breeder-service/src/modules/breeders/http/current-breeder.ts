import type { Request } from 'express';
import type { NewBreeder } from '../domain/breeder.js';

export type CurrentBreederResolver = (req: Request) => Promise<NewBreeder>;
