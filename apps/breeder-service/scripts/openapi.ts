import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { openApiDocument } from '../src/openapi/document.js';

/** Commitovaný artefakt; drift hlídá tests/unit/openapi-document.test.ts. */
export const OPENAPI_FILE = fileURLToPath(
  new URL('../openapi.json', import.meta.url),
);

export async function renderOpenApiJson(): Promise<string> {
  const config = await resolveConfig(OPENAPI_FILE);
  return format(JSON.stringify(openApiDocument()), {
    ...config,
    filepath: OPENAPI_FILE,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(OPENAPI_FILE, await renderOpenApiJson());
  console.log(`Wrote ${OPENAPI_FILE}`);
}
