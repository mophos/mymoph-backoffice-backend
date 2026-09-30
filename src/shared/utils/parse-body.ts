import type { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { z } from 'zod';

/**
 * ตรวจ body ด้วย zod โดยไม่ให้ throw
 *
 * ของเดิมหลายโมดูลเรียก schema.parse() ตรง ๆ ใน handler ที่เป็น async
 * และไม่มี try/catch หรือ asyncHandler ครอบ ทั้งโปรเจกต์ก็ไม่มี error middleware กลาง
 * ผลคือ body ที่ผิดรูปแบบทำให้เกิด unhandled rejection แล้ว **process ตายทั้งตัว**
 * ไม่ใช่แค่ตอบ 400 กลับไป
 *
 * คืน null เมื่อไม่ผ่าน และตอบ 400 ให้เรียบร้อยแล้ว ผู้เรียกแค่ return ออกไป
 */
export const parseBody = <T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  res: Response,
  errorCode = 'INVALID_PAYLOAD'
): z.infer<T> | null => {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  res.status(StatusCodes.BAD_REQUEST).json({
    ok: false,
    error: errorCode,
    details: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      rule: issue.code
    }))
  });
  return null;
};
