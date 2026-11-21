/**
 * MongoMemoryServer vybere volný port dřív, než ho mongod obsadí. Souběžné testovací
 * procesy (Turborepo + vitest workery) si ho mezitím mohou vzít a start skončí
 * „Port … already in use“. Opakovaný start téže instance zvolí nový port.
 * @template {{ start(): Promise<void> }} T
 * @param {T} server nespuštěná instance (`new MongoMemoryServer()`)
 * @returns {Promise<T>}
 */
export async function startTestMongo(server) {
  if (
    process.env.ANICO_DEV_SERVICE ||
    process.env.TEST_MONGODB_URI ||
    process.env.MONGODB_URI
  )
    throw new Error(
      'Integration tests require MongoMemoryServer; remote or configured MongoDB is forbidden',
    );
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
