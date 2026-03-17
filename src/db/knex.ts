import knex, { Knex } from 'knex';
import { config } from '../config/env';

const createMysqlKnex = (connectionConfig: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): Knex =>
  knex({
    client: 'mysql2',
    connection: {
      host: connectionConfig.host,
      port: connectionConfig.port,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      timezone: 'Z'
    },
    pool: {
      min: 2,
      max: 20
    }
  });

export const systemDb: Knex = createMysqlKnex({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password
});

export const mymophDb: Knex = createMysqlKnex({
  host: config.mymophDb.host,
  port: config.mymophDb.port,
  database: config.mymophDb.database,
  user: config.mymophDb.user,
  password: config.mymophDb.password
});

// Backward-compatible alias for system database.
export const db: Knex = systemDb;
