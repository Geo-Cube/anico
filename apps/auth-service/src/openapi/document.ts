import { z } from 'zod';
import {
  AuthProviderSchema,
  ConnectionStartResponseSchema,
  IdentitySchema,
  LoginErrorCodeSchema,
  ProvidersResponseSchema,
  ServiceHealthResponseSchema,
  SessionSchema,
} from '@anico/shared-schemas';

type JsonObject = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const opaque = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' };
const string = { type: 'string' };
const dateTime = { type: 'string', format: 'date-time' };
const json = (schema: JsonObject) => ({ 'application/json': { schema } });
const parameter = (
  name: string,
  location: 'path' | 'query' | 'header',
  schema: JsonObject = string,
  required = true,
  description?: string,
) => ({
  name,
  in: location,
  required,
  schema,
  ...(description ? { description } : {}),
});
const origin = parameter(
  'Origin',
  'header',
  string,
  true,
  'Přesně AUTH_PUBLIC_ORIGIN pro browser; pro development grant přesný loopback origin, na který byl vydán.',
);
const csrf = parameter(
  'x-csrf-token',
  'header',
  string,
  true,
  'csrfToken z GET /session. Browser mutace vyžadují současně správný Origin.',
);
const provider = parameter('provider', 'path', ref('AuthProvider'));
const browserSecurity = [{ BrowserSession: [] }, { LocalBrowserSession: [] }];
const sessionSecurity = [...browserSecurity, { DevelopmentToken: [] }];
const cookieHeader = {
  description:
    'HTTPS: __Host-anico-session / __Host-anico-login; HTTP: anico-local-session / anico-local-login. HttpOnly; Path=/; bez Domain; Secure pouze HTTPS. Relace SameSite=Lax, Max-Age=AUTH_SESSION_SECONDS (výchozí 28800, rozsah 300–86400). Login cookie Max-Age=600, SameSite=None pouze pro Apple login (vyžaduje HTTPS), jinak Lax. Smazání používá Max-Age=0.',
  schema: string,
};
const noStore = {
  description: 'Auth routy se nesmí cachovat.',
  schema: { type: 'string', const: 'no-store' },
};
const response = (description: string, schema?: JsonObject): JsonObject => ({
  description,
  headers: { 'Cache-Control': noStore },
  ...(schema ? { content: json(schema) } : {}),
});
const error = (description: string) => response(description, ref('Error'));
const commonErrors = {
  '400': error(
    'Invalid request (Zod validace), Invalid JSON nebo chybný vstup dle operace.',
  ),
  '413': error('Payload too large: JSON nad 32 KiB nebo formulář nad 16 KiB.'),
  '429': {
    description:
      'Limit 120 požadavků za 60 sekund na IP. Textová odpověď express-rate-limit; health, ready a internal/verify jsou vyňaty.',
    headers: {
      'Retry-After': {
        schema: { type: 'integer' },
        description: 'Počet sekund do opakování.',
      },
      RateLimit: {
        schema: string,
        description: 'Standardní hlavička draft-8.',
      },
      'RateLimit-Policy': { schema: string },
    },
    content: { 'text/html': { schema: string } },
  },
  '500': error('Internal server error; soukromé detaily se nevracejí.'),
};
const authErrors = {
  '401': error(
    'AUTHENTICATION_REQUIRED, SESSION_EXPIRED, ACCOUNT_DISABLED; propojení: RECENT_LOGIN_REQUIRED; schválení delegace: DEVELOPMENT_REQUEST_EXPIRED; development token: DEVELOPMENT_LOGIN_REQUIRED, DEVELOPMENT_SESSION_EXPIRED, DEVELOPMENT_LOGIN_UNAVAILABLE.',
  ),
  '403': error(
    'CSRF_REJECTED nebo DEVELOPMENT_ORIGIN_REJECTED; změna admin role: OWNER_REQUIRED; propojení s development hlavičkou: ACCOUNT_MANAGEMENT_REQUIRES_BROWSER.',
  ),
};
function operation(
  summary: string,
  success: JsonObject,
  extra: JsonObject = {},
): JsonObject {
  const { rateLimited = true, ...metadata } = extra;
  const errors = { ...commonErrors };
  if (!rateLimited) delete (errors as JsonObject)['429'];
  return {
    summary,
    tags: ['Přihlášení'],
    security: [],
    responses: { ...errors, ...success },
    ...metadata,
  };
}
const body = (schema: JsonObject, form = false) => ({
  required: true,
  content: {
    ...(form ? { 'application/x-www-form-urlencoded': { schema } } : {}),
    'application/json': { schema },
  },
});
const object = (
  properties: JsonObject,
  required = Object.keys(properties),
) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const redirect = (description: string, cookies = false) => ({
  ...response(description),
  headers: {
    'Cache-Control': noStore,
    Location: { schema: string, description: 'Cílová URL přesměrování.' },
    ...(cookies ? { 'Set-Cookie': cookieHeader } : {}),
  },
  content: {
    'text/plain': { schema: string },
    'text/html': { schema: string },
  },
});
const loopback = {
  type: 'string',
  maxLength: 200,
  description:
    'Přesná kanonická URL http://127.0.0.1:<port>/callback, port 1024–65535, bez query, fragmentu a credentials.',
};
const callbackFields = {
  state: { type: 'string', minLength: 20, maxLength: 256 },
  code: string,
  error: string,
  error_description: string,
  user: {
    type: 'string',
    description:
      'Volitelný Apple form_post údaj; nikdy není důvěryhodnou identitou sám o sobě.',
  },
};
const callbackOperation = (post: boolean) =>
  operation(
    post
      ? 'OIDC callback (zejména Apple form_post)'
      : 'OIDC callback přes query',
    {
      '303': redirect(
        'Úspěch: AUTH_PUBLIC_ORIGIN + ověřená návratová cesta (výchozí /), nová relace a smazání login cookie; předchozí relace se zneplatní. Selhání: /prihlaseni?error=<LoginErrorCode>, u známého link flow /ucet?error=<LoginErrorCode>; smaže se jen login cookie. Chyby callbacku včetně chybné state se vracejí redirectem, nikoli JSON.',
        true,
      ),
    },
    {
      parameters: [
        provider,
        ...(post
          ? []
          : Object.entries(callbackFields).map(([name, schema]) =>
              parameter(name, 'query', schema, name === 'state'),
            )),
      ],
      ...(post
        ? {
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    properties: callbackFields,
                    required: ['state'],
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
          }
        : {}),
      description:
        'Prohlížeč musí vrátit login cookie ze zahájení. State je jednorázová a vázaná na browser, provider a 10minutovou expiraci; OIDC ověřuje nonce a podpis/issuer/audience ID tokenu, Google/Microsoft navíc PKCE S256 (Apple používá form_post bez PKCE). Link navíc vyžaduje tutéž aktuální browser relaci a přihlášení nejvýše 5 minut staré. Před vstupem do callback handleru může parser nebo limiter vrátit obecnou HTTP chybu.',
    },
  );

/** OpenAPI 3.1 ze sdílených schémat a skutečných HTTP kontraktů služby. */
export function openApiDocument(): JsonObject {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of [
    ['AuthProvider', AuthProviderSchema],
    ['ProvidersResponse', ProvidersResponseSchema],
    ['Session', SessionSchema],
    ['Identity', IdentitySchema],
    ['ConnectionStartResponse', ConnectionStartResponseSchema],
    ['LoginErrorCode', LoginErrorCodeSchema],
    ['ServiceHealthResponse', ServiceHealthResponseSchema],
  ] as const)
    registry.add(schema, { id });
  const generated = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
  });
  const schemas = Object.fromEntries(
    Object.entries(generated.schemas).map(([name, schema]) => {
      const { $schema: _dialect, ...value } = schema;
      return [name, value];
    }),
  );
  return {
    openapi: '3.1.0',
    info: {
      title: 'AniCo auth-service API',
      version: '0.1.0',
      description:
        'Serverové přihlášení Google/Microsoft/Apple, cookie relace, explicitní propojení účtů a delegované místní přihlášení. Bez heslového loginu a bez přijímání klientských x-user-* hlaviček. /internal/verify je pouze pro privátní gateway, nikoli veřejné API. Dokumentace je veřejná pouze mimo produkci. Všechny zde uvedené cesty jsou relativní ke službě.',
    },
    servers: [
      {
        url: '.',
        description:
          'Stejný origin a prefix jako openapi.json (přímo nebo /api/auth přes gateway).',
      },
    ],
    tags: [
      { name: 'Přihlášení' },
      {
        name: 'Místní vývoj',
        description:
          'Pouze při AUTH_DEVELOPMENT_ENABLED=true v APP_ENV=dev; jinak všechny /development cesty vracejí 404. Nejde o bypass loginu: vyžadují skutečný účet a souhlas v browseru.',
      },
      { name: 'Provoz' },
    ],
    security: [],
    components: {
      schemas: {
        ...schemas,
        Error: object({ error: string }),
        Jwks: object({
          keys: {
            type: 'array',
            items: object({
              kty: { const: 'EC', type: 'string' },
              crv: { const: 'P-256', type: 'string' },
              x: string,
              y: string,
              kid: string,
              alg: { const: 'ES256', type: 'string' },
              use: { const: 'sig', type: 'string' },
            }),
          },
        }),
      },
      securitySchemes: {
        BrowserSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-anico-session',
          description:
            'HTTPS HttpOnly relace. Swagger nemůže cookie nastavit přes autorizační dialog; přihlaste se nejdřív browserem.',
        },
        LocalBrowserSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'anico-local-session',
          description: 'Pouze HTTP varianta stejné browser relace.',
        },
        DevelopmentToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-anico-development-token',
          description:
            'Ne Authorization: Bearer. Pouze delegovaný grant, povinný odpovídající Origin, vyžaduje AUTH_DEVELOPMENT_ENABLED=true. Přítomnost hlavičky má přednost před cookie i při neplatném tokenu.',
        },
        GatewayKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-anico-gateway-key',
          description:
            'Privátní sdílený klíč gateway. Nedávat do veřejného browseru.',
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Liveness',
          tags: ['Provoz'],
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
          summary: 'Readiness databáze a shutdownu',
          tags: ['Provoz'],
          security: [],
          responses: {
            '200': {
              description: 'Služba je připravena.',
              content: json(ref('ServiceHealthResponse')),
            },
            '503': {
              description: 'Service unavailable',
              content: json(ref('Error')),
            },
          },
        },
      },
      '/providers': {
        get: operation('Nakonfigurovaní poskytovatelé', {
          '200': response(
            'Pouze aktivní nakonfigurované OIDC providery.',
            ref('ProvidersResponse'),
          ),
        }),
      },
      '/.well-known/jwks.json': {
        get: operation('Veřejný podpisový klíč identity', {
          '200': response(
            'JWKS s veřejným EC P-256 klíčem; žádné privátní d. JWT identity používá ES256, typ anico-identity+jwt, kid, sub=userId, iss, aud, iat, exp=30s, jti a identity.',
            ref('Jwks'),
          ),
        }),
      },
      '/login/{provider}': {
        get: operation(
          'Zahájit OIDC přihlášení',
          {
            '302': redirect(
              'Redirect na poskytovatele a login cookie vázaná na browser.',
              true,
            ),
            '503': error('PROVIDER_NOT_CONFIGURED nebo APPLE_REQUIRES_HTTPS.'),
          },
          {
            parameters: [
              provider,
              parameter(
                'returnTo',
                'query',
                { type: 'string', maxLength: 160 },
                false,
                'Pouze bezpečná ASCII cesta stejného originu bez //, dot segmentů, fragmentu, backslash nebo /api. Výjimka: přesný /api/auth/development/consent?request=<43znakové ID>. Jinak INVALID_LOGIN_RETURN.',
              ),
            ],
          },
        ),
      },
      '/login/{provider}/callback': {
        get: callbackOperation(false),
        post: callbackOperation(true),
      },
      '/connections/{provider}': {
        post: operation(
          'Propojit další provider s aktuálním účtem',
          {
            '200': {
              ...response(
                'Autorizační HTTPS URL; po dokončení callback rotuje relaci. Účty se neslučují podle e-mailu.',
                ref('ConnectionStartResponse'),
              ),
              headers: { 'Cache-Control': noStore, 'Set-Cookie': cookieHeader },
            },
            ...authErrors,
            '409': error('PROVIDER_ALREADY_CONNECTED'),
            '503': error(
              'LINK_PROVIDER_UNSUPPORTED (Apple) nebo PROVIDER_NOT_CONFIGURED.',
            ),
          },
          {
            security: browserSecurity,
            parameters: [provider, origin, csrf],
            description:
              'Jen browser; development hlavička je odmítnuta ACCOUNT_MANAGEMENT_REQUIRES_BROWSER. Poslední přihlášení musí být nejvýše 5 minut staré, jinak RECENT_LOGIN_REQUIRED.',
          },
        ),
      },
      '/session': {
        get: operation(
          'Aktuální identita a CSRF token',
          {
            '200': response(
              'Session včetně linkedProviders. canManageAccounts=false pro development grant.',
              ref('Session'),
            ),
            ...authErrors,
          },
          {
            security: sessionSecurity,
            parameters: [
              parameter(
                'Origin',
                'header',
                string,
                false,
                'Povinný pouze pro development token; musí odpovídat originu grantu.',
              ),
            ],
          },
        ),
      },
      '/logout': {
        post: operation(
          'Zneplatnit aktuální relaci',
          {
            '204': {
              ...response(
                'Browser: relace zneplatněna a session cookie smazána. Development: zneplatněn grant bez mazání cookie.',
              ),
              headers: { 'Cache-Control': noStore, 'Set-Cookie': cookieHeader },
            },
            ...authErrors,
          },
          {
            security: sessionSecurity,
            parameters: [
              origin,
              parameter(
                'x-csrf-token',
                'header',
                string,
                false,
                'Povinný pouze pro browser relaci; development token používá jen kontrolu Origin.',
              ),
            ],
          },
        ),
      },
      '/users/{userId}/admin': {
        put: operation(
          'Owner přidělí nebo odebere roli admin',
          {
            '200': response(
              'Aktualizovaná veřejná identita.',
              object({ identity: ref('Identity') }),
            ),
            ...authErrors,
            '404': error(
              'ELIGIBLE_USER_NOT_FOUND: neexistující nebo nezpůsobilý cílový účet.',
            ),
          },
          {
            security: sessionSecurity,
            parameters: [
              parameter('userId', 'path', { type: 'string', format: 'uuid' }),
              origin,
              parameter(
                'x-csrf-token',
                'header',
                string,
                false,
                'Povinný pouze pro browser relaci.',
              ),
            ],
            requestBody: body(object({ admin: { type: 'boolean' } })),
            description:
              'Vyžaduje roli owner, jinak OWNER_REQUIRED. Mění pouze admin roli způsobilého aktivního ne-fixture účtu, nikoli owner roli.',
          },
        ),
      },
      '/internal/verify': {
        get: operation(
          'Privátní ověření relace pro gateway',
          {
            '204': {
              ...response(
                'Ověřeno; gateway získá krátkodobý podepsaný JWT identity.',
              ),
              headers: {
                'Cache-Control': noStore,
                'X-Anico-Identity': {
                  schema: string,
                  description: 'ES256 JWT s životností 30 sekund, viz JWKS.',
                },
              },
            },
            '401': error('GATEWAY_REQUIRED nebo chyba relace/grantu.'),
            '403': authErrors['403'],
            '500': commonErrors['500'],
          },
          {
            rateLimited: false,
            security: sessionSecurity.map((security) => ({
              ...security,
              GatewayKey: [],
            })),
            parameters: [
              parameter(
                'x-forwarded-method',
                'header',
                string,
                false,
                'Původní HTTP metoda. U browser relace vynechání nebo metoda mimo GET/HEAD/OPTIONS vyžaduje CSRF a Origin.',
              ),
              parameter(
                'Origin',
                'header',
                string,
                false,
                'Povinný pro mutaci browseru a každý development grant.',
              ),
              parameter(
                'x-csrf-token',
                'header',
                string,
                false,
                'Povinný při mutaci browseru.',
              ),
            ],
            description:
              'Gateway musí tuto cestu držet privátní. Sdílený klíč je pouze defense in depth. Route je vyňata z rate limitu.',
          },
        ),
      },
      '/development/authorize': {
        get: operation(
          'Zahájit delegaci pro místní aplikaci s PKCE',
          {
            '303': redirect(
              'Na consent nebo přes zvolený Google/Microsoft login.',
            ),
            '503': error('PROVIDER_NOT_CONFIGURED'),
          },
          {
            tags: ['Místní vývoj'],
            parameters: [
              parameter('client_id', 'query', {
                type: 'string',
                const: 'anico-local-development',
              }),
              parameter('response_type', 'query', {
                type: 'string',
                const: 'code',
              }),
              parameter('redirect_uri', 'query', loopback),
              parameter('state', 'query', opaque),
              parameter('code_challenge', 'query', opaque),
              parameter('code_challenge_method', 'query', {
                type: 'string',
                const: 'S256',
              }),
              parameter(
                'provider',
                'query',
                { type: 'string', enum: ['google', 'microsoft'] },
                false,
              ),
            ],
            description:
              'Query je strict: další parametry jsou odmítnuty. Request expiruje za 5 minut. Neplatný redirect: INVALID_DEVELOPMENT_REDIRECT.',
          },
        ),
      },
      '/development/consent': {
        get: operation(
          'Browser stránka přihlášení nebo výslovného souhlasu',
          {
            '200': {
              ...response(
                'HTML: přihlášení nebo formulář souhlasu s CSRF tokenem. Přihlášená stránka omezuje form-action na self a schválený loopback origin.',
              ),
              content: { 'text/html': { schema: string } },
            },
            '401': error('DEVELOPMENT_REQUEST_EXPIRED'),
          },
          {
            tags: ['Místní vývoj'],
            parameters: [parameter('request', 'query', opaque)],
            description:
              'Browser cookie je volitelná; bez platné relace zobrazí přihlašovací odkazy. Nikdy nepřebírá development token jako browser relaci.',
          },
        ),
      },
      '/development/approve': {
        post: operation(
          'Potvrdit nebo odmítnout delegaci',
          {
            '303': redirect(
              'Na ověřenou loopback callback URL s původním state a jednorázovým code (60 sekund) nebo error=access_denied.',
            ),
            ...authErrors,
          },
          {
            tags: ['Místní vývoj'],
            security: browserSecurity,
            parameters: [origin],
            requestBody: body(
              object({
                request: opaque,
                csrfToken: { type: 'string', maxLength: 128 },
                decision: { type: 'string', enum: ['allow', 'deny'] },
              }),
              true,
            ),
            description:
              'CSRF je ve formulářovém těle, nikoli v hlavičce. Request lze spotřebovat jen jednou.',
          },
        ),
      },
      '/development/token': {
        post: operation(
          'Vyměnit jednorázový kód a PKCE verifier za grant',
          {
            '200': response(
              'Opaque token; posílat jako x-anico-development-token společně s Origin, nikoli Authorization: Bearer. Expirace nejvýše 8 hodin a nikdy za expirací rodičovské browser relace.',
              object({
                access_token: opaque,
                token_type: { type: 'string', const: 'Bearer' },
                expires_at: dateTime,
              }),
            ),
            '401': error('INVALID_DEVELOPMENT_CODE nebo ACCOUNT_DISABLED'),
          },
          {
            tags: ['Místní vývoj'],
            requestBody: body(
              object({
                client_id: { type: 'string', const: 'anico-local-development' },
                grant_type: { type: 'string', const: 'authorization_code' },
                code: opaque,
                code_verifier: {
                  type: 'string',
                  maxLength: 128,
                  description:
                    '43–128 znaků [A-Za-z0-9._~-], SHA-256 musí odpovídat code_challenge.',
                },
                redirect_uri: loopback,
              }),
              true,
            ),
          },
        ),
      },
      '/development/identity': {
        post: operation(
          'Krátkodobá podepsaná identita pro místní proxy',
          {
            '200': response(
              'Podepsaný JWT identity s životností 30 sekund.',
              object({ identityToken: string, expiresAt: dateTime }),
            ),
            ...authErrors,
          },
          {
            tags: ['Místní vývoj'],
            security: [{ DevelopmentToken: [] }],
            parameters: [origin],
          },
        ),
      },
      '/development/logout': {
        post: operation(
          'Zneplatnit development grant',
          {
            '204': response('Grant zneplatněn, browser relace zůstává.'),
            ...authErrors,
          },
          {
            tags: ['Místní vývoj'],
            security: [{ DevelopmentToken: [] }],
            parameters: [origin],
          },
        ),
      },
    },
  };
}
