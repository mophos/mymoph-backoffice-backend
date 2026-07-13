import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/env';

const safeCompare = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};

export const internalServiceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const providedKey = req.header('x-internal-api-key');
  if (!providedKey || !safeCompare(providedKey, config.taxInternalApiKey)) {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'INVALID_INTERNAL_API_KEY' });
    return;
  }

  next();
};
