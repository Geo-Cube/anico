import { readFile } from 'node:fs/promises';
import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, renderOpenApiJson } from '../../scripts/openapi.js';
import { healthRouter } from '../../src/health/health-router.js';
import { AnimalRouter } from '../../src/modules/animal/http/router.js';
import { DocumentsRouter } from '../../src/modules/documents/http/documents-router.js';
import { openApiDocument } from '../../src/openapi/document.js';

type Json = Record<string, any>;
const document = openApiDocument() as Json;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'];

function routesOf(router: Router): string[] {
  return router.stack.flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    // Express 5 drží metody routy v `route.methods` (mimo veřejné typy)
    const methods = 'methods' in route ? route.methods : undefined;
    if (typeof methods !== 'object' || methods === null)
      throw new Error(`Route ${route.path} has no methods`);
    const path = String(route.path).replace(/:(\w+)/g, '{$1}');
    return Object.keys(methods).map((method) => `${method} ${path}`);
  });
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectRefs(item, refs));
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child);
      else collectRefs(child, refs);
    }
  return refs;
}

describe('OpenAPI document of animal-service', () => {
  it('matches the committed openapi.json (run `npm run openapi -w @anico/animal-service`)', async () => {
    expect(await readFile(OPENAPI_FILE, 'utf8')).toBe(
      await renderOpenApiJson(),
    );
  });

  it('documents exactly the routes registered by the animal, documents and health routers', () => {
    const unused = async () => {
      throw new Error('not called');
    };
    const files = { save: unused, open: unused, delete: unused };
    const fromRouters = [
      ...routesOf(healthRouter({ isReady: () => true })),
      ...routesOf(
        AnimalRouter({
          repository: {
            create: unused,
            find: unused,
            list: unused,
            update: unused,
            deleteOwned: unused,
          },
          photos: files,
          photoVariants: files,
          resizer: { variants: unused },
          documentFiles: files,
          verification: { isVerified: unused },
          newId: () => '',
          logger: { warn: () => undefined },
        }),
      ),
      ...routesOf(
        DocumentsRouter({
          repository: {
            load: unused,
            saveVersions: unused,
            decide: unused,
            reviewQueue: unused,
          },
          files,
          verification: { isVerified: unused },
          newId: () => '',
          logger: { warn: () => undefined },
        }),
      ),
    ].sort();
    const fromDocument = Object.entries(document.paths as Json)
      .flatMap(([path, item]) =>
        Object.keys(item as Json)
          .filter((key) => METHODS.includes(key))
          .map((method) => `${method} ${path}`),
      )
      .sort();
    expect(fromDocument).toEqual(fromRouters);
  });

  it('resolves every reference and declares every path parameter', () => {
    for (const ref of collectRefs(document)) {
      const [, , section, name] = ref.split('/');
      expect(document.components[section!], ref).toHaveProperty([name!]);
    }
    for (const [path, item] of Object.entries(document.paths as Json)) {
      const templated = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const declared = ((item.parameters as Json[]) ?? []).map((p) => p.name);
      expect(declared.sort(), path).toEqual(templated.sort());
    }
  });
});
