import mongoose from 'mongoose';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3001;
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/anico_document';

async function startServer(): Promise<void> {
  try {
    console.log('Připojování k MongoDB pro document-service...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB úspěšně připojeno.');

    const app = createApp();

    const server = app.listen(PORT, () => {
      console.log(`Document Service úspěšně naslouchá na portu ${PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`Přijat signál ${signal}. Ukončování Document Service...`);
      server.close(async () => {
        await mongoose.disconnect();
        console.log('Databázové spojení uzavřeno. Proces ukončen.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    console.error('Kritická chyba při startu Document Service:', error);
    process.exit(1);
  }
}

void startServer();
