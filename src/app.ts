import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config/env';
import { apiV1Routes } from './routes/index';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';

process.env.TZ = config.timezone;

export const app = express();

app.use(helmet());
app.use(cors({
  origin: config.frontendBaseUrl,
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, _res, next) => {
  req.requestId = uuidv4();
  next();
});

app.use('/api/v1', apiV1Routes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
