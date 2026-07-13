import { app } from './app';
import { config } from './config/env';
import { closeMymophMongo } from './db/mongodb';

const server = app.listen(config.port, () => {
  console.log(`MyMOPH Backoffice API running on port ${config.port} (${config.timezone})`);
});

const shutdown = (signal: string): void => {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => {
    void closeMymophMongo().finally(() => process.exit(0));
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
