import * as Sentry from '@sentry/node';
import type { ErrorEvent, Log } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import {
  initObservability,
  scrubEvent,
  scrubLog,
} from '../../src/observability.js';

function failedRequestEvent(): ErrorEvent {
  return {
    type: undefined,
    request: {
      method: 'POST',
      url: 'https://dev.anico.online/api/x?token=query-secret#fragment-secret',
      query_string: { token: 'query-secret' },
      cookies: { anico_session: 'cookie-secret' },
      headers: {
        authorization: 'Bearer header-secret',
        'cf-access-authenticated-user-email': 'tajny@example.test',
      },
      data: '{"emailAddress":"body-secret@example.test"}',
      env: { REMOTE_ADDR: '203.0.113.7' },
    },
    user: { id: 'u1', email: 'tajny@example.test', ip_address: '203.0.113.7' },
    breadcrumbs: [
      { message: 'GET https://idp.example.test/?code=crumb-secret' },
    ],
    exception: {
      values: [
        {
          type: 'MongoServerError',
          value: 'E11000 dup key: tajny@example.test',
        },
      ],
    },
  };
}

describe('monitoring neodesílá osobní údaje ani tajemství', () => {
  it('bez SENTRY_DSN se SDK neinicializuje a nic neodesílá', () => {
    expect(initObservability({ dsn: '', service: 'test' })).toBe(false);
    expect(initObservability({ dsn: undefined, service: 'test' })).toBe(false);
    expect(Sentry.getClient()).toBeUndefined();
  });

  it('z události odstraní cookies, hlavičky, tělo, query, IP a uživatele', () => {
    const event = scrubEvent(failedRequestEvent(), false);

    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://dev.anico.online/api/x',
    });
    expect(event.user).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/secret|203\.0\.113\.7/);
    // Bez potlačení zůstává zpráva výjimky pro diagnostiku.
    expect(event.exception?.values?.[0]?.value).toBe(
      'E11000 dup key: tajny@example.test',
    );
  });

  it('při potlačení soukromých detailů pošle místo zprávy jen typ chyby', () => {
    const event = scrubEvent(failedRequestEvent(), true);

    expect(event.exception?.values).toEqual([
      { type: 'MongoServerError', value: 'MongoServerError' },
    ]);
    expect(JSON.stringify(event)).not.toMatch(/secret|tajny@example\.test/);
  });

  it('log sond /health a /ready zahodí, jinde ponechá jen metodu, cestu a status', () => {
    const probe = (url: string): Log => ({
      level: 'info',
      message: 'request completed',
      attributes: { req: { method: 'GET', url } },
    });
    expect(scrubLog(probe('/health'), false)).toBeNull();
    expect(scrubLog(probe('/ready?x=1'), false)).toBeNull();

    const log = scrubLog(
      {
        level: 'info',
        message: 'request completed',
        attributes: {
          responseTime: 4,
          req: {
            id: 1,
            method: 'GET',
            url: '/breeders/me?token=query-secret',
            query: { token: 'query-secret' },
            headers: {
              cookie: '[Redacted]',
              'x-forwarded-for': '203.0.113.7',
              'cf-access-authenticated-user-email': 'tajny@example.test',
            },
            remoteAddress: '203.0.113.7',
          },
          res: { statusCode: 200, headers: { 'set-cookie': 'cookie-secret' } },
        },
      },
      false,
    );

    expect(log?.attributes).toEqual({
      responseTime: 4,
      req: { method: 'GET', url: '/breeders/me' },
      res: { statusCode: 200 },
    });
  });

  it('při potlačení pošle z chybového logu jen typ a rámce zásobníku, ne zprávu', () => {
    const message = 'db failed token=log-secret';
    const frames = '    at handler (/app/dist/app.js:1:1)';
    const serialized = {
      type: 'MongoServerError',
      message,
      stack: `MongoServerError: ${message}\n${frames}`,
    };
    // SDK předává `err` z Pina jako objekt i jako JSON řetězec; `logger.error(err)`
    // bez vlastní zprávy navíc kopíruje text chyby do těla logu a do `msg`.
    for (const err of [serialized, JSON.stringify(serialized)]) {
      const log = scrubLog(
        { level: 'error', message, attributes: { err, msg: message } },
        true,
      );

      expect(JSON.stringify(log)).not.toMatch(/log-secret/);
      expect(log?.attributes?.err).toEqual({
        type: 'MongoServerError',
        stack: frames,
      });
      expect(log?.message).toBe('MongoServerError');
      expect(log?.attributes?.msg).toBe('MongoServerError');
    }
  });
});
