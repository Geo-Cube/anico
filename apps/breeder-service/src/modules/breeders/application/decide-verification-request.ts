import type { Breeder } from '../domain/breeder.js';
import {
  InvalidDecisionError,
  VerificationAlreadyDecidedError,
  VerificationRequestNotFoundError,
  VerificationRevisionMismatchError,
} from '../domain/errors.js';
import type { Decision } from '../domain/internal-types.js';
import type {
  BreederRepository,
  DecisionNotifier,
  WarnLogger,
} from '../domain/ports.js';

export function decideVerificationRequest(dependencies: {
  breeders: BreederRepository;
  notifier: DecisionNotifier;
  logger: WarnLogger;
  now?: () => Date;
}) {
  const { breeders, notifier, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  return async (
    requestId: string,
    decision: Decision,
    admin: { id: string },
  ): Promise<Breeder> => {
    // rozhodnout lze jen žádost ve stavu PENDING v revizi, kterou admin posoudil
    // (atomicky v repozitáři); REJECTED je konečné, RETURNED vrací žádost
    // chovateli k opravě a oprava zvýší revizi
    let normalized: Decision = decision;
    if (decision.decision === 'REJECTED') {
      const reason = decision.rejectionReason.trim();
      if (reason === '') throw new InvalidDecisionError();
      normalized = {
        decision: 'REJECTED',
        revision: decision.revision,
        rejectionReason: reason,
      };
    } else if (decision.decision === 'RETURNED') {
      const reason = decision.returnReason.trim();
      if (reason === '') {
        throw new InvalidDecisionError('Return reason is required');
      }
      normalized = {
        decision: 'RETURNED',
        revision: decision.revision,
        returnReason: reason,
      };
    }

    const decided = await breeders.decideVerification(requestId, {
      ...normalized,
      reviewedBy: admin.id,
      reviewedAt: now(),
    });

    if (!decided) {
      const current = await breeders.findByVerificationRequestId(requestId);
      if (!current) throw new VerificationRequestNotFoundError();
      // stále PENDING => rozhodnutí se týká jiné revize, než je uložená
      if (current.verificationRequest?.status === 'PENDING') {
        throw new VerificationRevisionMismatchError(current);
      }
      throw new VerificationAlreadyDecidedError(current);
    }

    // e-mail až po uložení; jeho selhání rozhodnutí nezruší
    try {
      await notifier.notifyDecision(decided);
    } catch (error) {
      logger.warn(
        {
          requestId,
          breederId: decided.breederId,
          errorName: error instanceof Error ? error.name : 'unknown',
        },
        'Decision notification failed; the decision itself was saved',
      );
    }

    return decided;
  };
}
