import type { Breeder } from './breeder.js';

export interface DecisionEmail {
  to: string;
  subject: string;
  text: string;
}

export function decisionEmail(breeder: Breeder): DecisionEmail {
  const request = breeder.verificationRequest;

  if (!request || request.status === 'PENDING') {
    throw new Error('Cannot build decision e-mail for an undecided request');
  }
  if (!breeder.emailAddress) {
    throw new Error('Cannot build decision e-mail without a recipient');
  }

  const greeting = `Dobrý den, ${breeder.firstName} ${breeder.lastName},`;

  if (request.status === 'APPROVED') {
    return {
      to: breeder.emailAddress,
      subject: 'AniCo: váš účet chovatele byl ověřen',
      text: [
        greeting,
        '',
        'vaše žádost o ověření účtu chovatele byla schválena. Účet je nyní ověřen.',
        '',
        'Tým AniCo',
      ].join('\n'),
    };
  }

  if (request.status === 'RETURNED') {
    return {
      to: breeder.emailAddress,
      subject: 'AniCo: žádost o ověření účtu byla vrácena k doplnění',
      text: [
        greeting,
        '',
        'vaše žádost o ověření účtu chovatele byla vrácena k doplnění.',
        '',
        `Důvod: ${request.returnReason ?? 'neuveden'}`,
        '',
        'Žádost můžete v aplikaci AniCo opravit a znovu odeslat ke schválení.',
        '',
        'Tým AniCo',
      ].join('\n'),
    };
  }

  return {
    to: breeder.emailAddress,
    subject: 'AniCo: žádost o ověření účtu byla zamítnuta',
    text: [
      greeting,
      '',
      'vaše žádost o ověření účtu chovatele byla zamítnuta.',
      '',
      `Důvod: ${request.rejectionReason ?? 'neuveden'}`,
      '',
      'Upozornění: zamítnutí je konečné, žádost o ověření účtu nelze podat znovu.',
      '',
      'Tým AniCo',
    ].join('\n'),
  };
}
