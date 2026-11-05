import { describe, expect, it } from 'vitest';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { decisionEmail } from '../../src/modules/breeders/domain/decision-email.js';
import type { VerificationStatus } from '../../src/modules/breeders/domain/internal-types.js';

function breeder(
  status: VerificationStatus | null,
  reason: string | null = null,
): Breeder {
  return {
    breederId: 'user-1',
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.com',
    breedingStationName: 'Stanice',
    breedingStationNumber: '123456',
    hasBreedingStation: true,
    isVerified: status === 'APPROVED',
    verificationRequest: status
      ? {
          requestId: 'a'.repeat(24),
          status,
          submittedAt: new Date('2026-01-01T00:00:00Z'),
          lastSubmittedAt: new Date('2026-01-01T00:00:00Z'),
          revision: 1,
          breedingStationCertificate: { fileName: 'c.pdf', fileReference: 'f' },
          reviewedBy: 'admin',
          reviewedAt: new Date('2026-01-02T00:00:00Z'),
          rejectionReason: status === 'REJECTED' ? reason : null,
          returnReason: status === 'RETURNED' ? reason : null,
          reviewHistory: [],
        }
      : null,
  };
}

describe('decisionEmail', () => {
  it('builds approval e-mail', () => {
    const email = decisionEmail(breeder('APPROVED'));
    expect(email.to).toBe('jan@example.com');
    expect(email.subject).toContain('ověřen');
    expect(email.text).toContain('schválena');
  });

  it('builds rejection e-mail with reason and a final-decision note', () => {
    const email = decisionEmail(breeder('REJECTED', 'Nečitelný certifikát'));
    expect(email.to).toBe('jan@example.com');
    expect(email.text).toContain('Nečitelný certifikát');
    expect(email.text).toContain('zamítnutí je konečné');
  });

  it('builds return e-mail with reason and a note that it can be corrected and resubmitted', () => {
    const email = decisionEmail(breeder('RETURNED', 'Doplňte číslo stanice'));
    expect(email.to).toBe('jan@example.com');
    expect(email.subject).toContain('vrácena k doplnění');
    expect(email.text).toContain('Důvod: Doplňte číslo stanice');
    expect(email.text).toContain('opravit a znovu odeslat');
    expect(email.text).not.toContain('konečné');
  });

  it('throws for pending request', () => {
    expect(() => decisionEmail(breeder('PENDING'))).toThrow();
  });

  it('throws when there is no request', () => {
    expect(() => decisionEmail(breeder(null))).toThrow();
  });
});
