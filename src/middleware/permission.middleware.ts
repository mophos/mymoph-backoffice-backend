import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { PermissionCode } from '../shared/types/auth';

export const requirePermission = (...required: PermissionCode[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const current = req.auth;
    if (!current) {
      res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'UNAUTHORIZED' });
      return;
    }

    const hasAll = required.every((item) => current.permissions.includes(item));
    if (!hasAll) {
      res.status(StatusCodes.FORBIDDEN).json({ ok: false, error: 'FORBIDDEN', required });
      return;
    }

    next();
  };
};
