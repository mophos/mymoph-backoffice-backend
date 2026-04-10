import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import multer from 'multer';

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
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(StatusCodes.REQUEST_TOO_LONG).json({
        ok: false,
        error: 'FILE_TOO_LARGE',
        field: error.field ?? null
      });
      return;
    }

    res.status(StatusCodes.BAD_REQUEST).json({
      ok: false,
      error: 'UPLOAD_ERROR',
      code: error.code
    });
    return;
  }

  console.error('[error]', req.originalUrl, error);
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    ok: false,
    error: 'INTERNAL_SERVER_ERROR'
  });
};
