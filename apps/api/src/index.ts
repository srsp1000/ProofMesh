import { loadAndValidateEnv } from './config/env.js';
import { buildServer } from './server.js';
import { createDatabasePool } from '@proofmesh/db';

async function start() {
  const env = loadAndValidateEnv();
  const pool = createDatabasePool({ connectionString: env.DATABASE_URL });

  const app = await buildServer({ pool, logger: true });

  const closeGracefully = async (signal: string) => {
    app.log.info(`Received ${signal}. Closing gracefully...`);
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void closeGracefully('SIGINT'));
  process.on('SIGTERM', () => void closeGracefully('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`ProofMesh API running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only start when invoked directly
if (process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts')) {
  void start();
}
