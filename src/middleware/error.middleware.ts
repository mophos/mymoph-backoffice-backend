import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(StatusCodes.NOT_FOUND).json({
    ok: false,
    error: 'NOT_FOUND',
    path: req.originalUrl
  });
};

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('[error]', req.originalUrl, error);
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    ok: false,
    error: 'INTERNAL_SERVER_ERROR'
  });
};
