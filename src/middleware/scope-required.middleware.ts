import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

export const requireAssignedScopeMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.auth) {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  if (req.auth.scopeType === 'ALL') {
    next();
    return;
  }

  if (req.auth.hospcodes.length > 0) {
    next();
    return;
  }

  res.status(StatusCodes.FORBIDDEN).json({
    ok: false,
    error: 'NO_SCOPE_ASSIGNED'
  });
};

