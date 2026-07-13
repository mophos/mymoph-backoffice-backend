import { Db, MongoClient } from 'mongodb';
import { config } from '../config/env';

let clientPromise: Promise<MongoClient> | null = null;

export class MymophMongoConfigurationError extends Error {
  constructor() {
    super('MYMOPH_MONGO_URI is not configured');
    this.name = 'MymophMongoConfigurationError';
  }
}

const getClient = async (): Promise<MongoClient> => {
  if (!config.mymophMongo.uri) {
    throw new MymophMongoConfigurationError();
  }

  if (!clientPromise) {
    const client = new MongoClient(config.mymophMongo.uri, {
      connectTimeoutMS: 10_000,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      maxPoolSize: 20,
      minPoolSize: 0
    });

    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
};

export const getMymophMongoDb = async (): Promise<Db> => {
  const client = await getClient();
  return client.db(config.mymophMongo.database);
};

export const closeMymophMongo = async (): Promise<void> => {
  if (!clientPromise) return;

  try {
    const client = await clientPromise;
    await client.close();
  } finally {
    clientPromise = null;
  }
};
