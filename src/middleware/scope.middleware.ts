import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

const parseHospcodes = (value: unknown): string[] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const scopeMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth) {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  if (req.auth.scopeType === 'ALL') {
    req.effectiveHospcodes = [];
    next();
    return;
  }

  const requested = parseHospcodes(req.query.hospcode ?? req.body?.hospcode ?? req.body?.hospcodes);
  if (!requested.length) {
    req.effectiveHospcodes = req.auth.hospcodes;
    next();
    return;
  }

  const denied = requested.filter((code) => !req.auth?.hospcodes.includes(code));
  if (denied.length) {
    res.status(StatusCodes.FORBIDDEN).json({
      ok: false,
      error: 'SCOPE_FORBIDDEN',
      deniedHospcodes: denied
    });
    return;
  }

  req.effectiveHospcodes = requested;
  next();
};
