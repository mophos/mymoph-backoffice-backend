import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

/**
 * ด่านนี้ตรวจแค่ว่า "บัญชีนี้ได้รับขอบเขตมาแล้วหรือยัง" เท่านั้น
 *
 * **ไม่ได้ตรวจว่ารหัสหน่วยงานที่ขอมาอยู่ในขอบเขตไหม** การตรวจข้อนั้นทำที่ชั้น service
 * ผ่าน `validateScope()` และ `validateReadScope()` ซึ่งเป็นที่เดียวที่รู้
 * ว่าคำขอนั้นเป็นการอ่านหรือเขียน และรู้วิธีแปลงรหัส code5 กับ hcode9 ให้ตรงกัน
 *
 * SEC-03 เคยมี `scope.middleware.ts` ที่ตรวจรายรหัสอยู่ แต่ไม่ถูก mount ที่ route ใดเลย
 * จึงถอดออกเมื่อ 26 ต.ค. 2569 เพราะถ้าเอามาใช้จริงจะผิดสองทาง
 *   1. เทียบรหัสแบบสตริงดิบ ผู้ใช้ที่ส่ง hcode9 มาจะถูกปฏิเสธทั้งที่มีสิทธิ์
 *   2. ไม่รู้จักกฎ D-22 ที่ให้ผู้ดูแลการเงินอ่านข้ามหน่วยงานได้
 *
 * ถ้าจะเพิ่มด่านรายรหัสในอนาคต ต้องทำที่ชั้นที่รู้บริบทสองข้อนั้น ไม่ใช่ที่ middleware
 */
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

