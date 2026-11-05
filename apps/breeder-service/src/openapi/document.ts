import { z } from 'zod';
import {
  AdminVerificationRequestSchema,
  BreederProfileSchema,
  CertificateFileSchema,
  DecideVerificationRequestSchema,
  MyAccountSchema,
  ObjectIdSchema,
  ReviewDecisionSchema,
  ServiceHealthResponseSchema,
  SubmitVerificationRequestSchema,
  VerificationRequestListSchema,
  VerificationRequestSchema,
  VerificationReviewSchema,
  VerificationStatusSchema,
  VerificationSummarySchema,
  accountSchema,
} from '@anico/shared-schemas';
import {
  CERTIFICATE_FIELD,
  MAX_CERTIFICATE_BYTES,
} from '../modules/breeders/http/parse-upload.js';

type JsonObject = Record<string, unknown>;

const QUEUE_LIMIT = 500;
const CERTIFICATE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

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
const MyAccountConflictSchema = z.strictObject({
  error: z.string(),
  current: MyAccountSchema,
});
const AdminVerificationRequestConflictSchema = z.strictObject({
  error: z.string(),
  current: AdminVerificationRequestSchema,
});
const SubmitVerificationRequestFormSchema =
  SubmitVerificationRequestSchema.extend({
    [CERTIFICATE_FIELD]: z
      .file()
      .optional()
      .describe(
        `Certifikát chovatelské stanice: PDF, JPEG nebo PNG (typ se ověřuje podle obsahu souboru, ne podle přípony či hlavičky), nejvýše ${MAX_CERTIFICATE_BYTES / 1024 / 1024} MiB. Povinný mimo opravu vrácené žádosti (RETURNED); při opravě nepovinný – bez souboru zůstává původní certifikát.`,
      ),
  });

/** Komponenty pojmenované podle exportů `@anico/shared-schemas` (bez přípony `Schema`). */
const components = [
  ['ObjectId', ObjectIdSchema],
  ['VerificationStatus', VerificationStatusSchema],
  ['AccountState', accountSchema],
  ['ReviewDecision', ReviewDecisionSchema],
  ['VerificationReview', VerificationReviewSchema],
  ['CertificateFile', CertificateFileSchema],
  ['VerificationRequest', VerificationRequestSchema],
  ['MyAccount', MyAccountSchema],
  ['SubmitVerificationRequest', SubmitVerificationRequestSchema],
  ['SubmitVerificationRequestForm', SubmitVerificationRequestFormSchema],
  ['DecideVerificationRequest', DecideVerificationRequestSchema],
  ['BreederProfile', BreederProfileSchema],
  ['AdminVerificationRequest', AdminVerificationRequestSchema],
  ['VerificationRequestList', VerificationRequestListSchema],
  ['VerificationSummary', VerificationSummarySchema],
  ['ServiceHealthResponse', ServiceHealthResponseSchema],
  ['Error', ErrorSchema],
  ['ValidationError', ValidationErrorSchema],
  ['MyAccountConflict', MyAccountConflictSchema],
  ['AdminVerificationRequestConflict', AdminVerificationRequestConflictSchema],
] as const;

export type ComponentName = (typeof components)[number][0];

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
const json = (schema: JsonObject) => ({
  'application/json': { schema },
});
const errorResponse = (
  description: string,
  schema: JsonObject = ref('Error'),
) => ({
  description,
  content: json(schema),
});

const responses = {
  Unauthorized: errorResponse(
    'Chybí platná identita (`x-anico-identity`) – `{"error":"Authentication required"}`.',
  ),
  Forbidden: errorResponse(
    'Identita nemá roli `admin` ani `owner` – `{"error":"Insufficient permissions"}`.',
  ),
  NotFound: errorResponse('Záznam neexistuje – `{"error":"Not found"}`.'),
  InternalError: errorResponse(
    'Neočekávaná chyba – `{"error":"Internal server error"}`.',
  ),
  PayloadTooLarge: errorResponse(
    'Tělo nebo soubor přesahuje limit – `{"error":"Payload too large"}`.',
  ),
};
const responseRef = (name: keyof typeof responses) => ({
  $ref: `#/components/responses/${name}`,
});

const certificateDownload = {
  description:
    'Soubor certifikátu ke stažení (`Content-Disposition: attachment`).',
  headers: {
    'Content-Disposition': {
      description:
        '`attachment; filename="<ASCII>"; filename*=UTF-8\'\'<původní název>`',
      schema: { type: 'string' },
    },
    'Content-Length': { schema: { type: 'integer', minimum: 0 } },
  },
  content: Object.fromEntries(
    CERTIFICATE_TYPES.map((type) => [
      type,
      { schema: { type: 'string', contentMediaType: type } },
    ]),
  ),
};

const requestIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description:
    'ID žádosti o ověření (`verificationRequest.id`). Neplatné i neexistující ID vrací 404.',
  schema: ref('ObjectId'),
};

const adminSecurity = [{ identity: [] }];
const adminNote = 'Vyžaduje roli `admin` nebo `owner`.';

/** OpenAPI 3.1 dokument breeder-service sestavený ze sdílených Zod schémat. */
export function openApiDocument(): JsonObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AniCo breeder-service',
      version: '0.1.0',
      description: [
        'Ověření chovatele (UC-01): chovatel podá žádost s certifikátem chovatelské stanice, administrátor ji schválí, zamítne, nebo vrátí k doplnění.',
        '',
        'Stavy žádosti: `PENDING` (čeká na posouzení) → `APPROVED` | `REJECTED` (konečné) | `RETURNED` (vráceno k doplnění; chovatel opraví a znovu odešle → `PENDING`). Každé rozhodnutí se přidá do `reviewHistory` (nejstarší první).',
        '',
        'Identitu doplňuje gateway, resp. lokální vývojový most z přihlášení, do hlavičky `x-anico-identity`; klient ji nikdy nevkládá ani nezná.',
      ].join('\n'),
    },
    servers: [
      {
        url: '.',
        description:
          'Relativně k umístění dokumentu (funguje i za prefixem gateway, např. /api/breeder).',
      },
    ],
    tags: [
      { name: 'breeder', description: 'Účet přihlášeného chovatele.' },
      {
        name: 'verification-admin',
        description: 'Posuzování žádostí (role `admin` | `owner`).',
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
      '/breeders/me': {
        get: {
          tags: ['breeder'],
          operationId: 'getMyAccount',
          summary: 'Můj účet chovatele',
          description:
            'Idempotentně převezme profil z identity. Před prvním podáním je `accountState` `NOT_SUBMITTED`, profilová pole mohou být `null` a `verificationRequest` je `null`.',
          responses: {
            '200': {
              description: 'Účet chovatele.',
              content: json(ref('MyAccount')),
            },
            '401': responseRef('Unauthorized'),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/breeders/me/verification-request': {
        post: {
          tags: ['breeder'],
          operationId: 'submitVerificationRequest',
          summary: 'Podat nebo opravit žádost o ověření',
          description: [
            'Povoleno ve stavech `NOT_SUBMITTED` (první podání) a `RETURNED` (oprava vrácené žádosti); jinak po úspěšné validaci 409 s aktuálním účtem. Před podáním se idempotentně převezme profil z identity, předchozí `GET /breeders/me` není nutný.',
            '',
            `Mimo opravu vrácené žádosti (\`RETURNED\`) je \`${CERTIFICATE_FIELD}\` povinný; jeho absence vrací 400 ve všech ostatních stavech (validace má přednost před 409). Při opravě je nepovinný: bez souboru zůstává původní certifikát. Oprava nastaví stav \`PENDING\`, \`lastSubmittedAt\` na aktuální čas a vynuluje \`returnReason\` a \`reviewedBy\`/\`reviewedAt\`; \`submittedAt\` a \`reviewHistory\` zůstávají.`,
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: ref('SubmitVerificationRequestForm'),
                encoding: {
                  [CERTIFICATE_FIELD]: {
                    contentType: CERTIFICATE_TYPES.join(', '),
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Žádost přijata, stav `PENDING`.',
              content: json(ref('MyAccount')),
            },
            '400': errorResponse(
              `Neplatná pole nebo chybějící certifikát mimo opravu vrácené žádosti (RETURNED) (\`issues[].path\` = \`["${CERTIFICATE_FIELD}"]\`), případně nečitelný multipart (\`{"error":"Invalid upload"}\`). Validace má přednost před 409.`,
              { oneOf: [ref('ValidationError'), ref('Error')] },
            ),
            '401': responseRef('Unauthorized'),
            '409': errorResponse(
              'Validní podání (mimo `RETURNED` včetně souboru) ve stavu `PENDING`, `APPROVED` nebo `REJECTED` (zamítnutí je konečné), nebo souběžná oprava už uspěla; `current` je aktuální účet.',
              ref('MyAccountConflict'),
            ),
            '413': responseRef('PayloadTooLarge'),
            '415': errorResponse(
              'Obsah souboru není PDF, JPEG ani PNG – `{"error":"Certificate must be a PDF, JPEG or PNG file"}`.',
            ),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/breeders/me/verification-request/certificate': {
        get: {
          tags: ['breeder'],
          operationId: 'downloadMyCertificate',
          summary: 'Stáhnout můj certifikát',
          description:
            'Vždy jen certifikát přihlášeného chovatele (ID z identity, ne z URL).',
          responses: {
            '200': certificateDownload,
            '401': responseRef('Unauthorized'),
            '404': errorResponse(
              'Chovatel zatím žádost nepodal (žádný certifikát) – `{"error":"Not found"}`.',
            ),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/verification-requests': {
        get: {
          tags: ['verification-admin'],
          operationId: 'listVerificationRequests',
          summary: 'Fronta žádostí',
          description: `${adminNote} Bez \`status\` vrací jen \`PENDING\`. Řazeno podle \`lastSubmittedAt\` vzestupně (nejdéle čekající první), nejvýše ${QUEUE_LIMIT} položek.`,
          security: adminSecurity,
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              description: 'Filtr stavu žádosti; výchozí `PENDING`.',
              schema: { ...ref('VerificationStatus'), default: 'PENDING' },
            },
          ],
          responses: {
            '200': {
              description: 'Žádosti s profilem chovatele.',
              content: json(ref('VerificationRequestList')),
            },
            '400': errorResponse('Neplatný dotaz.', ref('ValidationError')),
            '401': responseRef('Unauthorized'),
            '403': responseRef('Forbidden'),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/verification-requests/summary': {
        get: {
          tags: ['verification-admin'],
          operationId: 'getVerificationSummary',
          summary: 'Počty žádostí podle stavu',
          description: adminNote,
          security: adminSecurity,
          responses: {
            '200': {
              description: 'Počty ve všech čtyřech stavech.',
              content: json(ref('VerificationSummary')),
            },
            '401': responseRef('Unauthorized'),
            '403': responseRef('Forbidden'),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/verification-requests/{id}': {
        get: {
          tags: ['verification-admin'],
          operationId: 'getVerificationRequest',
          summary: 'Detail žádosti',
          description: adminNote,
          security: adminSecurity,
          parameters: [requestIdParameter],
          responses: {
            '200': {
              description: 'Žádost s profilem chovatele.',
              content: json(ref('AdminVerificationRequest')),
            },
            '401': responseRef('Unauthorized'),
            '403': responseRef('Forbidden'),
            '404': responseRef('NotFound'),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/verification-requests/{id}/certificate': {
        get: {
          tags: ['verification-admin'],
          operationId: 'downloadVerificationCertificate',
          summary: 'Stáhnout certifikát žádosti',
          description: adminNote,
          security: adminSecurity,
          parameters: [requestIdParameter],
          responses: {
            '200': certificateDownload,
            '401': responseRef('Unauthorized'),
            '403': responseRef('Forbidden'),
            '404': responseRef('NotFound'),
            '500': responseRef('InternalError'),
          },
        },
      },
      '/verification-requests/{id}/decision': {
        post: {
          tags: ['verification-admin'],
          operationId: 'decideVerificationRequest',
          summary: 'Rozhodnout o žádosti',
          description: `${adminNote} Rozhodnout lze jen žádost ve stavu \`PENDING\` (atomicky). \`APPROVED\` ověří chovatele; \`REJECTED\` je konečné a vyžaduje \`rejectionReason\`; \`RETURNED\` vrátí žádost k doplnění s \`returnReason\` a chovatel ji může opravit a znovu odeslat. Rozhodnutí se zapíše do \`reviewHistory\` a chovatel dostane e-mail (selhání e-mailu rozhodnutí nevrací). Data chovatele administrátor needituje.`,
          security: adminSecurity,
          parameters: [requestIdParameter],
          requestBody: {
            required: true,
            content: json(ref('DecideVerificationRequest')),
          },
          responses: {
            '200': {
              description: 'Rozhodnutá žádost.',
              content: json(ref('AdminVerificationRequest')),
            },
            '400': errorResponse(
              'Neplatné rozhodnutí nebo chybějící/prázdný důvod; nevalidní JSON vrací `{"error":"Invalid JSON"}`.',
              { oneOf: [ref('ValidationError'), ref('Error')] },
            ),
            '401': responseRef('Unauthorized'),
            '403': responseRef('Forbidden'),
            '404': responseRef('NotFound'),
            '409': errorResponse(
              'Žádost už není ve stavu `PENDING`; `current` je její aktuální stav.',
              ref('AdminVerificationRequestConflict'),
            ),
            '413': responseRef('PayloadTooLarge'),
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
            'Krátkodobý podepsaný token identity. Hlavičku doplňuje gateway, v lokálním vývoji vývojový most z přihlášení; klient (prohlížeč, frontend) ji nikdy nevkládá a hodnotu přijatou od klienta gateway přepíše.',
        },
      },
    },
    security: [{ identity: [] }],
  };
}
