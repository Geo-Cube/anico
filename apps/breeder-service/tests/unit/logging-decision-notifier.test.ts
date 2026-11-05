import { describe, expect, it, vi } from 'vitest';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { loggingDecisionNotifier } from '../../src/modules/breeders/infrastructure/logging-decision-notifier.js';

const decided: Breeder = {
  breederId: 'user-1',
  firstName: 'Jan',
  lastName: 'Novák',
  emailAddress: 'jan@example.com',
  breedingStationName: 'Stanice',
  breedingStationNumber: '123456',
  hasBreedingStation: true,
  isVerified: false,
  verificationRequest: {
    requestId: 'a'.repeat(24),
    status: 'REJECTED',
    submittedAt: new Date(),
    breedingStationCertificate: { fileName: 'c.pdf', fileReference: 'f' },
    reviewedBy: 'admin',
    reviewedAt: new Date(),
    rejectionReason: 'Tajný důvod',
  },
};

describe('loggingDecisionNotifier', () => {
  it('logs only breederId, decision and delivered=false', async () => {
    const info = vi.fn();
    await loggingDecisionNotifier({ info }).notifyDecision(decided);

    expect(info).toHaveBeenCalledTimes(1);
    const [data, message] = info.mock.calls[0] as [unknown, string];
    expect(data).toEqual({
      breederId: 'user-1',
      decision: 'REJECTED',
      delivered: false,
    });
    const logged = JSON.stringify([data, message]);
    expect(logged).not.toContain('jan@example.com');
    expect(logged).not.toContain('Novák');
    expect(logged).not.toContain('Tajný důvod');
  });

  it('fails for an undecided request', async () => {
    const info = vi.fn();
    await expect(
      loggingDecisionNotifier({ info }).notifyDecision({
        ...decided,
        verificationRequest: null,
      }),
    ).rejects.toThrow();
    expect(info).not.toHaveBeenCalled();
  });
});
