import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, renderOpenApiJson } from '../../scripts/openapi.js';
import { openApiDocument } from '../../src/openapi/document.js';

type Operation = {
  responses: Record<string, { headers?: Record<string, unknown> }>;
  security: Record<string, string[]>[];
  parameters?: { in: string; name: string; required?: boolean }[];
  requestBody: { content: Record<string, unknown> };
};
type Document = {
  openapi: string;
  components: {
    schemas: Record<string, { enum?: string[]; required?: string[] }>;
    securitySchemes: Record<string, unknown>;
  };
  paths: Record<string, Record<string, Operation>>;
};
// In-process generator returns a generic JSON object; assertions below check its contract.
const document = openApiDocument() as unknown as Document;

function operation(path: string, method: string): Operation {
  const value = document.paths[path]?.[method];
  assert(value, `Missing operation: ${method} ${path}`);
  return value;
}

function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : collectRefs(child),
  );
}

describe('Auth OpenAPI kontrakt', () => {
  it('odpovídá verzionovanému artefaktu (npm run openapi -w @anico/auth-service)', async () => {
    expect(await readFile(OPENAPI_FILE, 'utf8')).toBe(
      await renderOpenApiJson(),
    );
  });

  it('je OpenAPI 3.1 s platnými interními referencemi a path parametry', () => {
    expect(document.openapi).toBe('3.1.0');
    for (const ref of collectRefs(document)) {
      expect(ref).toMatch(/^#\/components\/schemas\/[\w-]+$/);
      expect(document.components.schemas).toHaveProperty([
        ref.split('/').at(-1)!,
      ]);
    }
    for (const [path, item] of Object.entries(document.paths)) {
      for (const operation of Object.values(item)) {
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
        for (const status of Object.keys(operation.responses))
          expect(status).toMatch(/^[1-5]\d\d$/);
        const expected = [...path.matchAll(/\{(\w+)\}/g)]
          .map((match) => match[1])
          .sort();
        const actual = (operation.parameters ?? []).filter(
          (parameter) => parameter.in === 'path',
        );
        expect(actual.map((parameter) => parameter.name).sort()).toEqual(
          expected,
        );
        expect(actual.every((parameter) => parameter.required)).toBe(true);
        for (const security of operation.security) {
          for (const name of Object.keys(security))
            expect(document.components.securitySchemes).toHaveProperty(name);
        }
      }
    }
  });

  it('rozlišuje cookie, development grant a privátní gateway místo veřejného bearer JWT', () => {
    const schemes = document.components.securitySchemes;
    expect(schemes.BrowserSession).toMatchObject({
      in: 'cookie',
      name: '__Host-anico-session',
    });
    expect(schemes.LocalBrowserSession).toMatchObject({
      in: 'cookie',
      name: 'anico-local-session',
    });
    expect(schemes.DevelopmentToken).toMatchObject({
      in: 'header',
      name: 'x-anico-development-token',
    });
    expect(operation('/session', 'get').security).toEqual([
      { BrowserSession: [] },
      { LocalBrowserSession: [] },
      { DevelopmentToken: [] },
    ]);
    for (const requirement of operation('/internal/verify', 'get').security)
      expect(requirement).toHaveProperty('GatewayKey');
    expect(operation('/internal/verify', 'get').responses).not.toHaveProperty(
      '429',
    );
    expect(
      operation('/connections/{provider}', 'post').security,
    ).not.toContainEqual({ DevelopmentToken: [] });
  });

  it('popisuje callback redirecty, cookie a uzavřenou sadu veřejných chyb místo JSON selhání', () => {
    for (const method of ['get', 'post']) {
      const callback = operation('/login/{provider}/callback', method);
      expect(callback.responses['303']?.headers).toHaveProperty('Location');
      expect(callback.responses['303']?.headers).toHaveProperty('Set-Cookie');
      expect(callback.responses).not.toHaveProperty('401');
    }
    expect(document.components.schemas.LoginErrorCode?.enum).toEqual([
      'LOGIN_CANCELLED',
      'LOGIN_EXPIRED',
      'LOGIN_FAILED',
      'ACCOUNT_DISABLED',
      'IDENTITY_ALREADY_LINKED',
      'RECENT_LOGIN_REQUIRED',
      'PROVIDER_UNAVAILABLE',
    ]);
    expect(document.components.schemas.Session?.required).toEqual(
      expect.arrayContaining([
        'identity',
        'csrfToken',
        'expiresAt',
        'linkedProviders',
        'canManageAccounts',
      ]),
    );
    expect(
      operation('/development/approve', 'post').requestBody.content,
    ).toHaveProperty('application/x-www-form-urlencoded');
  });
});
