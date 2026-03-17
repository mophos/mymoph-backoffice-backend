import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import type { AuthContext } from '../types/auth';

interface AccessPayload {
  sub: string;
  cid: string;
  roles: string[];
  permissions: string[];
  hospcodes: string[];
  scopeType: 'ALL' | 'LIST';
  displayName?: string;
}

export class JwtService {
  signAccessToken(auth: AuthContext): string {
    const payload: AccessPayload = {
      sub: auth.userId,
      cid: auth.cid,
      roles: auth.roles,
      permissions: auth.permissions,
      hospcodes: auth.hospcodes,
      scopeType: auth.scopeType,
      displayName: auth.displayName
    };

    return jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpires as jwt.SignOptions['expiresIn'],
      issuer: 'moph-backoffice',
      audience: 'moph-backoffice-portal'
    });
  }

  verifyAccessToken(token: string): AccessPayload {
    return jwt.verify(token, config.jwt.accessSecret, {
      issuer: 'moph-backoffice',
      audience: 'moph-backoffice-portal'
    }) as AccessPayload;
  }

  getTokenRemainingSeconds(token: string): number {
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    const exp = typeof decoded?.exp === 'number' ? decoded.exp : null;
    if (!exp) {
      return 60;
    }

    const now = Math.floor(Date.now() / 1000);
    return Math.max(1, exp - now);
  }
}
