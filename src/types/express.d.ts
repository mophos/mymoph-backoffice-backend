import type { AuthContext } from '../shared/types/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
      effectiveHospcodes?: string[];
    }
  }
}

export {};
