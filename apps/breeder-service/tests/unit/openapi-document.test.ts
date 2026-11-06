import { readFile } from 'node:fs/promises';
import type { Router } from 'express';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, renderOpenApiJson } from '../../scripts/openapi.js';
import { breedersRouter } from '../../src/modules/breeders/http/breeders-router.js';
import { verificationRequestsRouter } from '../../src/modules/breeders/http/verification-requests-router.js';
import { healthRouter } from '../../src/health/health-router.js';
import { openApiDocument } from '../../src/openapi/document.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';

type Json = Record<string, any>;
const document = openApiDocument() as Json;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

function routesOf(prefix: string, router: Router): string[] {
  return router.stack.flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    // Express 5 drží metody routy v `route.methods` (mimo veřejné typy)
    const methods = 'methods' in route ? route.methods : undefined;
    if (typeof methods !== 'object' || methods === null) {
      throw new Error(`Route ${route.path} has no methods`);
    }
    const path = `${prefix}${route.path === '/' ? '' : route.path}`;
    const openApiPath = path.replace(/:(\w+)/g, '{$1}');
    return Object.keys(methods).map((method) => `${method} ${openApiPath}`);
  });
}

function routerOperations(): string[] {
  const repository = inMemoryBreeders();
  const files = inMemoryFiles();
  return [
    ...routesOf('', healthRouter({ isReady: () => true })),
    ...routesOf('/breeders', breedersRouter({ repository, files })),
    ...routesOf(
      '/verification-requests',
      verificationRequestsRouter({
        repository,
        files,
        notifier: { notifyDecision: async () => undefined },
        logger: pino({ level: 'silent' }),
      }),
    ),
  ].sort();
}

function documentOperations(): string[] {
  return Object.entries(document.paths as Json)
    .flatMap(([path, item]) =>
      Object.keys(item as Json)
        .filter((key) => METHODS.includes(key))
        .map((method) => `${method} ${path}`),
    )
    .sort();
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectRefs(item, refs));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child);
      else collectRefs(child, refs);
    }
  }
  return refs;
}

function operations(): [string, string, Json, Json][] {
  return Object.entries(document.paths as Json).flatMap(([path, item]) =>
    Object.entries(item as Json)
      .filter(([method]) => METHODS.includes(method))
      .map(
        ([method, operation]) =>
          [path, method, operation as Json, item as Json] as [
            string,
            string,
            Json,
            Json,
          ],
      ),
  );
}

describe('OpenAPI document', () => {
  it('matches the committed openapi.json (run `npm run openapi -w @anico/breeder-service`)', async () => {
    expect(await readFile(OPENAPI_FILE, 'utf8')).toBe(
      await renderOpenApiJson(),
    );
  });

  it('documents exactly the routes registered by the routers', () => {
    const fromRouters = routerOperations();
    expect(fromRouters).toHaveLength(11); // 9 business + /health + /ready
    expect(documentOperations()).toEqual(fromRouters);
  });

  it('is structurally valid OpenAPI 3.1', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({
      title: expect.any(String),
      version: expect.any(String),
    });

    for (const ref of collectRefs(document)) {
      expect(ref).toMatch(/^#\/components\/(schemas|responses)\/[\w-]+$/);
      const [, , section, name] = ref.split('/');
      expect(document.components[section!], ref).toHaveProperty([name!]);
    }

    const operationIds = new Set<string>();
    for (const [path, method, operation, item] of operations()) {
      const label = `${method} ${path}`;
      expect(operationIds.has(operation.operationId), label).toBe(false);
      operationIds.add(operation.operationId);
      expect(Object.keys(operation.responses).length, label).toBeGreaterThan(0);
      for (const status of Object.keys(operation.responses)) {
        expect(status, label).toMatch(/^[1-5]\d\d$/);
      }
      const templated = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const parameters = [
        ...((item.parameters as Json[]) ?? []),
        ...((operation.parameters as Json[]) ?? []),
      ];
      const pathParameters = parameters
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => {
          expect(parameter.required, label).toBe(true);
          return parameter.name;
        });
      expect(pathParameters.sort(), label).toEqual(templated.sort());
      for (const scheme of (operation.security ?? []) as Json[]) {
        for (const name of Object.keys(scheme)) {
          expect(document.components.securitySchemes, label).toHaveProperty([
            name,
          ]);
        }
      }
    }

    for (const schema of Object.values(document.components.schemas as Json)) {
      expect(schema).not.toHaveProperty('$schema');
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('describes identity, admin roles and the queue contract', () => {
    expect(document.components.securitySchemes.identity).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'x-anico-identity',
    });
    expect(document.security).toEqual([{ identity: [] }]);
    expect(document.paths['/health'].get.security).toEqual([]);

    for (const [path, , operation] of operations()) {
      if (!path.startsWith('/verification-requests')) continue;
      expect(operation.description, path).toContain('`admin` nebo `owner`');
      expect(operation.responses['403'], path).toBeDefined();
    }

    const list = document.paths['/verification-requests'].get;
    expect(list.parameters[0]).toMatchObject({
      name: 'status',
      in: 'query',
      schema: {
        $ref: '#/components/schemas/VerificationStatus',
        default: 'PENDING',
      },
    });
    expect(list.description).toContain('500');
    expect(document.components.schemas.VerificationStatus.enum).toEqual([
      'PENDING',
      'RETURNED',
      'APPROVED',
      'REJECTED',
    ]);
  });

  it('describes the multipart submission, conflicts and downloads', () => {
    const submit = document.paths['/breeders/me/verification-request'].post;
    const form = submit.requestBody.content['multipart/form-data'];
    expect(form.schema).toEqual({
      $ref: '#/components/schemas/SubmitVerificationRequestForm',
    });
    const formSchema =
      document.components.schemas.SubmitVerificationRequestForm;
    expect(formSchema.properties.breedingStationCertificate).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(formSchema.required).not.toContain('breedingStationCertificate');
    expect(formSchema.required).toEqual(
      expect.arrayContaining(['firstName', 'emailAddress']),
    );
    expect(Object.keys(submit.responses).sort()).toEqual(
      ['201', '400', '401', '409', '413', '415', '500'].sort(),
    );
    expect(submit.responses['409'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/MyAccountConflict',
    });
    expect(
      document.paths['/verification-requests/{id}/decision'].post.responses[
        '409'
      ].content['application/json'].schema,
    ).toEqual({
      $ref: '#/components/schemas/AdminVerificationRequestConflict',
    });
    expect(
      document.components.schemas.AdminVerificationRequestConflict.properties
        .error.enum,
    ).toEqual([
      'Verification already decided',
      'Verification revision mismatch',
    ]);
    // každá varianta rozhodnutí vyžaduje revizi podání
    for (const variant of document.components.schemas.DecideVerificationRequest
      .oneOf) {
      expect(variant.required).toContain('revision');
    }
    expect(document.components.schemas.VerificationRequest.required).toContain(
      'revision',
    );

    for (const path of [
      '/breeders/me/verification-request/certificate',
      '/verification-requests/{id}/certificate',
    ]) {
      const ok = document.paths[path].get.responses['200'];
      expect(Object.keys(ok.content).sort()).toEqual([
        'application/pdf',
        'image/jpeg',
        'image/png',
      ]);
      expect(ok.headers['Content-Disposition']).toBeDefined();
    }
  });
});
