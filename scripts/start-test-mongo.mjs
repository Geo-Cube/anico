/**
 * MongoMemoryServer vybere volný port dřív, než ho mongod obsadí. Souběžné testovací
 * procesy (Turborepo + vitest workery) si ho mezitím mohou vzít a start skončí
 * „Port … already in use“. Opakovaný start téže instance zvolí nový port.
 * @template {{ start(): Promise<void> }} T
 * @param {T} server nespuštěná instance (`new MongoMemoryServer()`)
 * @returns {Promise<T>}
 */
export async function startTestMongo(server) {
  const remoteUri = process.env.TEST_MONGODB_URI;
  if (remoteUri) {
    const base = new URL(remoteUri);
    if (!/^mongodb:$/.test(base.protocol))
      throw new Error('TEST_MONGODB_URI must use mongodb protocol');
    server.start = async () => undefined;
    // Remote development accounts have readWrite only for their personal service DB.
    // Never let integration test names or dbName overrides create another database.
    server.getUri = () => base.href;
    server.stop = async () => undefined;
    return server;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await server.start();
      return server;
    } catch (error) {
      const portTaken =
        error instanceof Error && /already in use/i.test(error.message);
      if (!portTaken || attempt >= 5) throw error;
    }
  }
}
