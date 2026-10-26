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

    /**
     * MONGO-02 ถ้า topology ตายหลังเชื่อมสำเร็จแล้ว ต้องทิ้ง client ตัวนั้น
     *
     * เดิมรีเซ็ต clientPromise เฉพาะตอน connect() ล้มเหลวครั้งแรกเท่านั้น
     * ถ้าตายทีหลัง ทุกคำขอจะได้ client เดิมที่ใช้ไม่ได้กลับไปตลอดอายุ process
     * โดยไม่มีเส้นทางสร้างใหม่ ต้อง restart ถึงจะกลับมาใช้ได้
     *
     * ทิ้งเฉพาะเมื่อยังชี้มาที่ client ตัวนี้ กัน race ตอนมีคนสร้างตัวใหม่ไปแล้ว
     */
    const discardIfCurrent = (reason: string) => {
      if (clientPromise !== pending) return;
      clientPromise = null;
      console.error('[dependency] MyMOPH MongoDB client ถูกทิ้ง จะเชื่อมใหม่ครั้งถัดไป', reason);
    };

    client.on('close', () => discardIfCurrent('close'));
    client.on('topologyClosed', () => discardIfCurrent('topologyClosed'));

    const pending: Promise<MongoClient> = client.connect().catch((error) => {
      discardIfCurrent('connect failed');
      throw error;
    });

    clientPromise = pending;
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
