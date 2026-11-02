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

export class VerificationRequestNotFoundError extends Error {
  constructor() {
    super('Verification request not found');
    this.name = 'VerificationRequestNotFoundError';
  }
}

export class VerificationAlreadyDecidedError extends Error {
  constructor(public readonly breeder: Breeder) {
    super('Verification already decided');
    this.name = 'VerificationAlreadyDecidedError';
  }
}

export class InvalidCertificateError extends Error {
  constructor() {
    super('Invalid certificate');
    this.name = 'InvalidCertificateError';
  }
}
