import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import multer from 'multer';
import {
  MongoClientClosedError,
  MongoNetworkError,
  MongoNotConnectedError,
  MongoOperationTimeoutError,
  MongoServerClosedError,
  MongoSystemError,
  MongoTopologyClosedError
} from 'mongodb';
import { ZodError } from 'zod';

export const notFoundMiddleware = (req: Request, res: Response): void => {
  res.status(StatusCodes.NOT_FOUND).json({
    ok: false,
    error: 'NOT_FOUND',
    path: req.originalUrl
  });
};


/**
 * MONGO-01 — error ของ mongo ที่แปลว่า "ปลายทางใช้ไม่ได้" ไม่ใช่ทุกตัว
 *
 * เดิมเทียบชื่อแบบตายตัวไว้ 3 ชื่อ ตัวที่เข้าข่ายเดียวกันแต่ชื่อไม่ตรงจึงตกไปเป็น 500
 * เช่น MongoNotConnectedError MongoServerClosedError MongoClientClosedError
 *
 * ตรวจด้วย instanceof เพื่อให้ครอบ subclass เองโดยไม่ต้องไล่ชื่อ
 * แต่ **ไม่ใช้ `instanceof MongoError` ตัวฐาน** เพราะกว้างเกินไป
 * ใน driver 7.x มี error 47 class ที่สืบทอดจาก MongoError และในนั้นมีทั้ง
 * เรื่องปลายทางล่ม กับเรื่องที่เป็นบั๊กของเราเองปนกัน เช่น
 * MongoInvalidArgumentError MongoParseError MongoCursorExhaustedError
 * ถ้าเหมาเป็น 503 ทั้งหมด ผู้ดูแลจะถูกชี้ไปผิดทางว่า MongoDB ล่ม
 * ทั้งที่ความจริงคือโค้ดเราส่ง argument ผิด
 *
 * รายการนี้เลือกเฉพาะสายที่แปลว่าเชื่อมต่อไม่ได้หรือ client ถูกปิดไปแล้ว
 * MongoNetworkError ครอบ MongoNetworkTimeoutError
 * MongoSystemError ครอบ MongoServerSelectionError
 */
const MONGO_UNAVAILABLE_ERRORS = [
  MongoNetworkError,
  MongoSystemError,
  MongoTopologyClosedError,
  MongoNotConnectedError,
  MongoServerClosedError,
  MongoClientClosedError,
  MongoOperationTimeoutError
] as const;

const isMongoUnavailable = (error: unknown): boolean =>
  MONGO_UNAVAILABLE_ERRORS.some((ErrorClass) => error instanceof ErrorClass);

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const errorName = error instanceof Error ? error.name : '';

  // OBS-01 ส่งชื่อ error ต่อให้ audit middleware บันทึกลงฐาน
  // เดิม error ถูกเขียนลง console เท่านั้น พอ log หายก็สืบ 500 ย้อนหลังไม่ได้
  // ตั้งตรงนี้ก่อนส่ง response เพราะ res.on('finish') ของ audit ทำงานหลังจากนั้น
  req.errorName = errorName || 'UnknownError';

  if (isMongoUnavailable(error) || errorName === 'MymophMongoConfigurationError') {
    console.error('[dependency] MyMOPH MongoDB unavailable', errorName);
    res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
      ok: false,
      error: 'MYMOPH_MONGO_UNAVAILABLE'
    });
    return;
  }

  // zod โผล่มาที่นี่เมื่อ handler เรียก schema.parse() ตรง ๆ
  // เดิมตกไปเป็น 500 INTERNAL_SERVER_ERROR ทั้งที่เป็นความผิดของ payload ฝั่งผู้เรียก
  if (error instanceof ZodError) {
    res.status(StatusCodes.BAD_REQUEST).json({
      ok: false,
      error: 'INVALID_PAYLOAD',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        rule: issue.code
      }))
    });
    return;
  }

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
