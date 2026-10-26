import type { AuthContext } from '../shared/types/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
      effectiveHospcodes?: string[];
      /** OBS-01 ชื่อ error ที่ errorMiddleware จับได้ ให้ audit บันทึกต่อ */
      errorName?: string;
    }
  }
}

export {};
