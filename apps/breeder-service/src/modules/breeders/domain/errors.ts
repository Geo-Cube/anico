import type { Breeder } from './breeder.js';

export class BreederNotFoundError extends Error {
  constructor() {
    super('Breeder not found');
    this.name = 'BreederNotFoundError';
  }
}

export class VerificationAlreadySubmittedError extends Error {
  constructor(public readonly breeder: Breeder) {
    super('Verification already submitted');
    this.name = 'VerificationAlreadySubmittedError';
  }
}
