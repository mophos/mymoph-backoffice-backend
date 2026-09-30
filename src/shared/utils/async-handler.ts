import type { NextFunction, Request, Response } from 'express';

/**
 * ส่ง error ของ handler แบบ async ไปให้ errorMiddleware
 *
 * Express 4 ไม่รู้จัก promise ที่ reject เอง ถ้า handler เป็น async แล้วมีอะไร throw
 * โดยไม่มีตัวจับ จะกลายเป็น unhandled rejection ซึ่ง Node ถือเป็น fatal
 * **process ตายทั้งตัว** คำขอของทุกคนที่ค้างอยู่ตายไปด้วย ไม่ใช่แค่ตอบ 500
 *
 * เดิมแต่ละโมดูลประกาศตัวนี้เองซ้ำ ๆ และห้าโมดูลไม่ได้ประกาศเลย
 */
export const asyncHandler = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};
