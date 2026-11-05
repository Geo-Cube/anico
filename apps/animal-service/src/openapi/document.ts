import { z } from 'zod';
import {
  AnimalDocumentFileSchema,
  AnimalDocumentHistorySchema,
  AnimalDocumentIdSchema,
  AnimalDocumentListSchema,
  AnimalDocumentSchema,
  AnimalDocumentsStateSchema,
  AnimalDocumentTypeSchema,
  AnimalIdSchema,
  AssessmentStatusSchema,
  DecideAnimalDocumentSchema,
  DocumentReviewListSchema,
  DocumentReviewSchema,
  MAX_DOCUMENTS_PER_SUBMISSION,
  ServiceHealthResponseSchema,
} from '@anico/shared-schemas';
import { MAX_DOCUMENT_FILE_BYTES } from '../modules/documents/domain/document-file.js';
import {
  FILE_FIELD,
  FILES_FIELD,
} from '../modules/documents/http/documents-router.js';

type JsonObject = Record<string, unknown>;

const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_MIB = MAX_DOCUMENT_FILE_BYTES / 1024 / 1024;
const fileDescription = `PDF, JPEG nebo PNG (typ se ověřuje podle obsahu, ne podle přípony či hlavičky), nejvýše ${MAX_MIB} MiB.`;

const ErrorSchema = z.strictObject({ error: z.string() });
const ValidationErrorSchema = z.strictObject({
  error: z.literal('Validation failed'),
  issues: z.array(
    z.looseObject({
      code: z.string(),
      path: z.array(z.union([z.string(), z.number()])),
      message: z.string(),
    }),
  ),
});
const AnimalDocumentConflictSchema = z.strictObject({
  error: z
    .enum([
      'Only a rejected document can be replaced',
      'Document version was already replaced',
      'Document already decided',
      'Document version is not current',
      'Documents changed concurrently; retry',
    ])
    .describe(
      'Důvod konfliktu. `current` (aktuální verze téže řady) chybí jen u `Documents changed concurrently; retry`.',
    ),
  current: AnimalDocumentSchema.optional(),
});
const SubmitAnimalDocumentsFormSchema = z.strictObject({
  documentTypes: z
    .array(AnimalDocumentTypeSchema)
    .min(1)
    .max(MAX_DOCUMENTS_PER_SUBMISSION)
    .describe(
      `Typ i-tého souboru v \`${FILES_FIELD}\` (stejné pořadí a počet). Každý typ nejvýše jednou.`,
    ),
  [FILES_FIELD]: z
    .array(z.file())
    .min(1)
    .max(MAX_DOCUMENTS_PER_SUBMISSION)
    .describe(fileDescription),
});
const ReplaceAnimalDocumentFormSchema = z.strictObject({
  [FILE_FIELD]: z.file().describe(fileDescription),
});

/** Komponenty pojmenované podle exportů `@anico/shared-schemas` (bez přípony `Schema`). */
const components = [
  ['AnimalId', AnimalIdSchema],
  ['AnimalDocumentId', AnimalDocumentIdSchema],
  ['AnimalDocumentType', AnimalDocumentTypeSchema],
  ['AssessmentStatus', AssessmentStatusSchema],
  ['AnimalDocumentsState', AnimalDocumentsStateSchema],
  ['AnimalDocumentFile', AnimalDocumentFileSchema],
  ['AnimalDocument', AnimalDocumentSchema],
  ['AnimalDocumentList', AnimalDocumentListSchema],
  ['AnimalDocumentHistory', AnimalDocumentHistorySchema],
  ['DecideAnimalDocument', DecideAnimalDocumentSchema],
  ['DocumentReview', DocumentReviewSchema],
  ['DocumentReviewList', DocumentReviewListSchema],
  ['SubmitAnimalDocumentsForm', SubmitAnimalDocumentsFormSchema],
  ['ReplaceAnimalDocumentForm', ReplaceAnimalDocumentFormSchema],
  ['AnimalDocumentConflict', AnimalDocumentConflictSchema],
  ['ServiceHealthResponse', ServiceHealthResponseSchema],
  ['Error', ErrorSchema],
  ['ValidationError', ValidationErrorSchema],
] as const;

type ComponentName = (typeof components)[number][0];

function componentSchemas(): Record<string, JsonObject> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of components) registry.add(schema, { id });
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
    override: ({ jsonSchema }) => {
      // `format: date-time` stačí; regex ze Zodu dokument jen znečitelní
      if (jsonSchema.format === 'date-time') delete jsonSchema.pattern;
      // multipart soubor podle OpenAPI 3.1: binární obsah, typy určuje `encoding`
      if (jsonSchema.format === 'binary') {
        delete jsonSchema.contentEncoding;
        jsonSchema.contentMediaType = 'application/octet-stream';
      }
    },
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      const { $schema: _schema, $id: _id, ...rest } = schema as JsonObject;
      return [id, rest];
    }),
  );
}

const ref = (name: ComponentName) => ({
  $ref: `#/components/schemas/${name}`,
});
const json = (schema: JsonObject) => ({ 'application/json': { schema } });
const errorResponse = (
  description: string,
  schema: JsonObject = ref('Error'),
) => ({ description, content: json(schema) });

const responses = {
  BadRequest: errorResponse(
    'Neplatné ID, tělo nebo dotaz (`Validation failed`), případně nečitelný multipart (`{"error":"Invalid upload"}`).',
    { oneOf: [ref('ValidationError'), ref('Error')] },
  ),
  Unauthorized: errorResponse(
    'Chybí platná identita (`x-anico-identity`) – `{"error":"Authentication required"}`.',
  ),
  BreederForbidden: errorResponse(
    'Chovatel nemá ověřený účet (UC-01) – `{"error":"Breeder is not verified"}`.',
  ),
  ReviewerForbidden: errorResponse(
    'Identita nemá roli `admin` ani `owner` – `{"error":"Insufficient permissions"}`.',
  ),
  NotFound: errorResponse(
    'Zvíře nebo doklad neexistuje, nebo patří jinému chovateli – `{"error":"Animal not found"}` / `{"error":"Document not found"}`.',
  ),
  PayloadTooLarge: errorResponse(
    `Soubor je větší než ${MAX_MIB} MiB – \`{"error":"Payload too large"}\`. Nic se neuloží.`,
  ),
  UnsupportedMediaType: errorResponse(
    'Obsah souboru není PDF, JPEG ani PNG – `{"error":"Document must be a PDF, JPEG or PNG file"}`. Nic se neuloží.',
  ),
  VerificationUnavailable: errorResponse(
    'Stav ověření chovatele nelze zjistit (breeder-service nedostupná) – `{"error":"Breeder verification unavailable"}`.',
  ),
  InternalError: errorResponse(
    'Neočekávaná chyba – `{"error":"Internal server error"}`.',
  ),
};
const responseRef = (name: keyof typeof responses) => ({
  $ref: `#/components/responses/${name}`,
});

const animalIdParameter = {
  name: 'animalId',
  in: 'path',
  required: true,
  description: 'ID zvířete.',
  schema: ref('AnimalId'),
};
const documentIdParameter = {
  name: 'documentId',
  in: 'path',
  required: true,
  description: 'ID konkrétní verze dokladu.',
  schema: ref('AnimalDocumentId'),
};
const breederRead = {
  '400': responseRef('BadRequest'),
  '401': responseRef('Unauthorized'),
  '403': responseRef('BreederForbidden'),
  '404': responseRef('NotFound'),
  '500': responseRef('InternalError'),
  '503': responseRef('VerificationUnavailable'),
};
const readAccess =
  'Vlastník zvířete s ověřeným účtem, nebo posuzovatel (role `admin` | `owner`), který ověření ani vlastnictví nepotřebuje.';
const conflict = (description: string) =>
  errorResponse(description, ref('AnimalDocumentConflict'));

/** OpenAPI 3.1 dokument dokladů zvířat (UC-03) sestavený ze sdílených Zod schémat. */
export function openApiDocument(): JsonObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AniCo animal-service – doklady zvířat',
      version: '0.1.0',
      description: [
        'Doklady zvířat (UC-03, ADR-0005): chovatel podá doklady ke svému zvířeti, administrátor je posoudí. Popisuje doklady a health; CRUD zvířat (UC-02) tento dokument zatím nezahrnuje.',
        '',
        'Každá příloha je samostatný doklad s řadou verzí. Zvíře má pro každý typ nejvýše jednu řadu: nový doklad stejného typu vytvoří další verzi (`versionNumber + 1`, `previousDocumentId`) a starší verze zůstává v historii včetně souboru a rozhodnutí. Rozhodnout lze jen o aktuální verzi ve stavu `PENDING`; rozhodnutí je konečné.',
        '',
        'Operace chovatele vyžadují ověřený účet z breeder-service, ověřuje se při každém požadavku. Identitu doplňuje gateway do hlavičky `x-anico-identity`.',
      ].join('\n'),
    },
    servers: [
      {
        url: '.',
        description:
          'Relativně k umístění dokumentu (za gateway prefixem /api/animal).',
      },
    ],
    tags: [
      { name: 'documents', description: 'Doklady vlastního zvířete.' },
      {
        name: 'document-review',
        description: 'Posuzování dokladů (role `admin` | `owner`).',
      },
      { name: 'health', description: 'Stav služby (veřejné).' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['health'],
          operationId: 'getHealth',
          summary: 'Liveness',
          security: [],
          responses: {
            '200': {
              description: 'Služba běží.',
              content: json(ref('ServiceHealthResponse')),
            },
          },
        },
      },
      '/ready': {
        get: {
          tags: ['health'],
          operationId: 'getReadiness',
          summary: 'Readiness (připojení k databázi)',
          security: [],
          responses: {
            '200': {
              description: 'Služba přijímá provoz.',
              content: json(ref('ServiceHealthResponse')),
            },
            '503': errorResponse(
              'Služba není připravena – `{"error":"Service unavailable"}`.',
            ),
          },
        },
      },
      '/animals/{animalId}/documents': {
        parameters: [animalIdParameter],
        post: {
          tags: ['documents'],
          operationId: 'submitAnimalDocuments',
          summary: 'Podat doklady',
          description: `Jen vlastník zvířete s ověřeným účtem. 1–${MAX_DOCUMENTS_PER_SUBMISSION} souborů; každý je samostatný doklad \`PENDING\`. Typ, který zvíře už má, pokračuje ve své řadě novou verzí (i nad \`PENDING\` či \`APPROVED\`). Podání se uloží celé, nebo vůbec.`,
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: ref('SubmitAnimalDocumentsForm'),
                encoding: {
                  [FILES_FIELD]: { contentType: DOCUMENT_TYPES.join(', ') },
                },
              },
            },
          },
          responses: {
            '201': {
              description:
                'Vytvořené verze (`documents` obsahuje jen nově podané doklady).',
              content: json(ref('AnimalDocumentList')),
            },
            ...breederRead,
            '409': conflict(
              'Doklady zvířete se opakovaně souběžně měnily – `Documents changed concurrently; retry`. Nic se neuložilo.',
            ),
            '413': responseRef('PayloadTooLarge'),
            '415': responseRef('UnsupportedMediaType'),
          },
        },
        get: {
          tags: ['documents'],
          operationId: 'listAnimalDocuments',
          summary: 'Aktuální doklady zvířete',
          description: `${readAccess} Vrací aktuální verzi každé řady a odvozený stav: \`PENDING\` > \`APPROVED\` > \`REJECTED\`, bez dokladů \`NOT_SUBMITTED\`.`,
          responses: {
            '200': {
              description: 'Aktuální verze.',
              content: json(ref('AnimalDocumentList')),
            },
            ...breederRead,
          },
        },
      },
      '/animals/{animalId}/documents/{documentId}/history': {
        parameters: [animalIdParameter, documentIdParameter],
        get: {
          tags: ['documents'],
          operationId: 'getAnimalDocumentHistory',
          summary: 'Historie verzí dokladu',
          description: `${readAccess} Všechny verze řady, do které \`documentId\` patří, nejstarší první.`,
          responses: {
            '200': {
              description: 'Verze řady.',
              content: json(ref('AnimalDocumentHistory')),
            },
            ...breederRead,
          },
        },
      },
      '/animals/{animalId}/documents/{documentId}/file': {
        parameters: [animalIdParameter, documentIdParameter],
        get: {
          tags: ['documents'],
          operationId: 'downloadAnimalDocument',
          summary: 'Stáhnout soubor verze',
          description: `${readAccess} Libovolná verze včetně historické, pod uloženým očištěným názvem.`,
          responses: {
            '200': {
              description:
                'Soubor ke stažení (`attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`).',
              headers: {
                'Content-Disposition': {
                  description:
                    '`attachment; filename="<ASCII>"; filename*=UTF-8\'\'<uložený název>`',
                  schema: { type: 'string' },
                },
                'Content-Length': { schema: { type: 'integer', minimum: 1 } },
              },
              content: Object.fromEntries(
                DOCUMENT_TYPES.map((type) => [
                  type,
                  { schema: { type: 'string', contentMediaType: type } },
                ]),
              ),
            },
            ...breederRead,
          },
        },
      },
      '/animals/{animalId}/documents/{documentId}/versions': {
        parameters: [animalIdParameter, documentIdParameter],
        post: {
          tags: ['documents'],
          operationId: 'replaceRejectedAnimalDocument',
          summary: 'Nová verze zamítnutého dokladu',
          description:
            'Jen vlastník zvířete s ověřeným účtem a jen nad aktuální verzí ve stavu `REJECTED`. Každou verzi lze nahradit jen jednou; druhý pokus vrátí 409 s aktuální verzí. Typ a zvíře se přebírají, původní soubor i rozhodnutí zůstávají.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: ref('ReplaceAnimalDocumentForm'),
                encoding: {
                  [FILE_FIELD]: { contentType: DOCUMENT_TYPES.join(', ') },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Nová aktuální verze `PENDING`.',
              content: json(ref('AnimalDocument')),
            },
            ...breederRead,
            '409': conflict(
              '`Only a rejected document can be replaced`, `Document version was already replaced`, nebo `Documents changed concurrently; retry`.',
            ),
            '413': responseRef('PayloadTooLarge'),
            '415': responseRef('UnsupportedMediaType'),
          },
        },
      },
      '/animals/{animalId}/documents/{documentId}/decision': {
        parameters: [animalIdParameter, documentIdParameter],
        post: {
          tags: ['document-review'],
          operationId: 'decideAnimalDocument',
          summary: 'Posoudit doklad',
          description:
            'Vyžaduje roli `admin` nebo `owner`. Rozhodnout lze jen aktuální verzi `PENDING` (atomicky); `REJECTED` vyžaduje `rejectionReason`. Rozhodnutí je konečné, druhý administrátor dostane 409 s uloženým výsledkem.',
          requestBody: {
            required: true,
            content: json(ref('DecideAnimalDocument')),
          },
          responses: {
            '200': {
              description: 'Rozhodnutá verze.',
              content: json(ref('AnimalDocument')),
            },
            '400': responseRef('BadRequest'),
            '401': responseRef('Unauthorized'),
            '403': responseRef('ReviewerForbidden'),
            '404': responseRef('NotFound'),
            '409': conflict(
              '`Document already decided`, nebo `Document version is not current` (mezitím podána novější verze).',
            ),
            '413': errorResponse(
              'Tělo přesahuje limit – `{"error":"Payload too large"}`.',
            ),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/document-reviews': {
        get: {
          tags: ['document-review'],
          operationId: 'listDocumentReviews',
          summary: 'Fronta dokladů k posouzení',
          description:
            'Vyžaduje roli `admin` nebo `owner`. Jen aktuální verze `PENDING`, nejdéle čekající první, nejvýše 500 položek, včetně údajů o zvířeti.',
          responses: {
            '200': {
              description: 'Doklady k posouzení.',
              content: json(ref('DocumentReviewList')),
            },
            '401': responseRef('Unauthorized'),
            '403': responseRef('ReviewerForbidden'),
            '500': responseRef('InternalError'),
          },
        },
      },
    },
    components: {
      schemas: componentSchemas(),
      responses,
      securitySchemes: {
        identity: {
          type: 'apiKey',
          in: 'header',
          name: 'x-anico-identity',
          description:
            'Krátkodobý podepsaný token identity. Doplňuje ho gateway, v lokálním vývoji vývojový most; klient ho nikdy nevkládá.',
        },
      },
    },
    security: [{ identity: [] }],
  };
}
