{
  "name": "@anico/__SERVICE_NAME__",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node --env-file-if-exists=.env dist/server.js",
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:coverage": "vitest run --coverage",
    "db:status": "tsx --env-file-if-exists=.env src/database/cli.ts status",
    "db:migrate": "tsx --env-file-if-exists=.env src/database/cli.ts migrate",
    "db:seed": "tsx --env-file-if-exists=.env src/database/cli.ts seed",
    "db:reset": "tsx --env-file-if-exists=.env src/database/cli.ts reset",
    "db:unlock": "tsx --env-file-if-exists=.env src/database/cli.ts unlock",
    "db:new": "tsx src/database/cli.ts new"
  },
  "dependencies": {
    "@anico/shared-schemas": "^0.1.0",
    "express": "^5.1.0",
    "mongoose": "^8.19.0",
    "pino": "^10.0.0",
    "pino-http": "^11.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/node": "^22.18.0",
    "@types/supertest": "^6.0.3",
    "@vitest/coverage-v8": "^4.0.0",
    "mongodb-memory-server": "^10.2.0",
    "supertest": "^7.1.4",
    "tsx": "^4.20.6",
    "vitest": "^4.0.0"
  }
}
