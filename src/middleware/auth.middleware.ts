import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JwtService } from '../shared/services/jwt.service';

const jwtService = new JwtService();

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authorization = req.header('authorization');
  const tokenFromBearer = authorization?.startsWith('Bearer ')
    ? authorization.substring('Bearer '.length)
    : null;
  const tokenFromCookie = req.cookies?.moph_bo_access;
  const token = tokenFromCookie ?? tokenFromBearer;

  if (!token) {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const payload = jwtService.verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      cid: payload.cid,
      roles: payload.roles,
      permissions: payload.permissions as any,
      hospcodes: payload.hospcodes,
      scopeType: payload.scopeType,
      displayName: payload.displayName
    };
    next();
  } catch {
    res.status(StatusCodes.UNAUTHORIZED).json({ ok: false, error: 'INVALID_ACCESS_TOKEN' });
  }
};
