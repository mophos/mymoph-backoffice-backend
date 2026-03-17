import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('4100'),
  TZ: z.string().default('Asia/Bangkok'),

  FRONTEND_BASE_URL: z.string().url(),
  API_BASE_URL: z.string().url(),

  DB_HOST: z.string(),
  DB_PORT: z.string().default('3306'),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  MYMOPH_DB_HOST: z.string().optional(),
  MYMOPH_DB_PORT: z.string().optional(),
  MYMOPH_DB_NAME: z.string().optional(),
  MYMOPH_DB_USER: z.string().optional(),
  MYMOPH_DB_PASSWORD: z.string().optional(),

  MYMOPH_TABLE_ATTENDANCE_LOGS: z.string().default('attendance_logs'),
  MYMOPH_TABLE_PAYROLL_RUNS: z.string().default('payroll_runs'),
  MYMOPH_TABLE_CHECKIN_OFFICES: z.string().default('checkin_offices'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES: z.string().default('12h'),
  JWT_REFRESH_EXPIRES_DAYS: z.string().default('30'),

  COOKIE_SECURE: z.string().default('false'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  PDF_FONT_PATH: z.string().optional(),

  MYMOPH_OAUTH_AUTHORIZE_URL: z.string().url(),
  MYMOPH_OAUTH_TOKEN_URL: z.string().url(),
  MYMOPH_OAUTH_USERINFO_URL: z.string().url(),
  MYMOPH_CLIENT_ID: z.string(),
  MYMOPH_CLIENT_SECRET: z.string(),
  MYMOPH_REDIRECT_URI: z.string().url(),
  MYMOPH_SCOPE: z.string().default('openid profile cid')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: Number(env.PORT),
  timezone: env.TZ,

  frontendBaseUrl: env.FRONTEND_BASE_URL,
  apiBaseUrl: env.API_BASE_URL,

  db: {
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  },

  mymophDb: {
    host: env.MYMOPH_DB_HOST ?? env.DB_HOST,
    port: Number(env.MYMOPH_DB_PORT ?? env.DB_PORT),
    database: env.MYMOPH_DB_NAME ?? env.DB_NAME,
    user: env.MYMOPH_DB_USER ?? env.DB_USER,
    password: env.MYMOPH_DB_PASSWORD ?? env.DB_PASSWORD
  },

  mymophTables: {
    attendanceLogs: env.MYMOPH_TABLE_ATTENDANCE_LOGS,
    payrollRuns: env.MYMOPH_TABLE_PAYROLL_RUNS,
    checkinOffices: env.MYMOPH_TABLE_CHECKIN_OFFICES
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpires: env.JWT_ACCESS_EXPIRES,
    refreshExpiresDays: Number(env.JWT_REFRESH_EXPIRES_DAYS)
  },

  cookie: {
    secure: env.COOKIE_SECURE === 'true',
    domain: env.COOKIE_DOMAIN,
    sameSite: env.COOKIE_SAME_SITE
  },

  pdf: {
    fontPath: env.PDF_FONT_PATH
  },

  oauth: {
    authorizeUrl: env.MYMOPH_OAUTH_AUTHORIZE_URL,
    tokenUrl: env.MYMOPH_OAUTH_TOKEN_URL,
    userInfoUrl: env.MYMOPH_OAUTH_USERINFO_URL,
    clientId: env.MYMOPH_CLIENT_ID,
    clientSecret: env.MYMOPH_CLIENT_SECRET,
    redirectUri: env.MYMOPH_REDIRECT_URI,
    scope: env.MYMOPH_SCOPE
  }
} as const;
