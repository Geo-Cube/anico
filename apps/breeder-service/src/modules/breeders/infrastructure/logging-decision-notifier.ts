import type { Logger } from 'pino';
import { decisionEmail } from '../domain/decision-email.js';
import type { DecisionNotifier } from '../domain/ports.js';

/**
 * Vývojový adaptér: e-mail nedoručuje, jen zaloguje, že rozhodnutí proběhlo.
 * Do logu nepatří tělo e-mailu, adresa ani jméno.
 * TODO: Doplnit skutečné doručování e-mailů.
 */
export function loggingDecisionNotifier(
  logger: Pick<Logger, 'info'>,
): DecisionNotifier {
  return {
    async notifyDecision(breeder) {
      decisionEmail(breeder); // ověří, že obsah jde sestavit
      logger.info(
        {
          breederId: breeder.breederId,
          decision: breeder.verificationRequest?.status,
          delivered: false,
        },
        'Decision e-mail was not delivered: development adapter without e-mail provider',
      );
    },
  };
}
