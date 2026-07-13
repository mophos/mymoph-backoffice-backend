import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { config } from '../../config/env';
import { MymophUsersModel } from './mymoph-users.model';

interface ListQuery {
  search: string;
  page: number;
  pageSize: number;
  offset: number;
}

export class MymophUsersService {
  constructor(private readonly model: MymophUsersModel) {}

  async list(auth: AuthContext, query: ListQuery) {
    const access = this.validateGlobalAccess(auth);
    if (!access.ok) return access;

    const search = query.search.trim();
    if (search.length < 3) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'SEARCH_TOO_SHORT' } as const;
    }

    const data = await this.model.list({
      search,
      pageSize: query.pageSize,
      offset: query.offset
    });

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        total: data.total,
        page: query.page,
        pageSize: query.pageSize,
        rows: data.rows.map((row) => ({
          id: row._id.toHexString(),
          cidMasked: this.maskCid(row.cid),
          email: String(row.email ?? ''),
          isKyc: this.normalizeKycStatus(row.is_kyc ?? row.is_ekyc),
          firstName: String(row.first_name ?? ''),
          lastName: String(row.last_name ?? '')
        }))
      }
    } as const;
  }

  async verifyHr(auth: AuthContext, id: string) {
    const access = this.validateGlobalAccess(auth);
    if (!access.ok) return access;

    const user = await this.model.findById(id);
    if (!user) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'MYMOPH_USER_NOT_FOUND' } as const;
    }

    const cid = String(user.cid ?? '').trim();
    if (!/^\d{13}$/.test(cid)) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'MYMOPH_USER_INVALID_CID' } as const;
    }

    const response = await axios.get(config.mymophMongo.hrStatusUrl, {
      params: { cid },
      timeout: 10_000,
      validateStatus: () => true,
      headers: { Accept: 'application/json' }
    });

    if (response.status >= 500) {
      return { ok: false, status: StatusCodes.BAD_GATEWAY, error: 'HR_STATUS_SERVICE_UNAVAILABLE' } as const;
    }

    const payload = response.data as { ok?: boolean } | undefined;
    return {
      ok: true,
      status: StatusCodes.OK,
      data: { found: Boolean(payload?.ok) }
    } as const;
  }

  async archiveDelete(
    auth: AuthContext,
    id: string,
    input: { reason: string; requestId?: string }
  ) {
    const access = this.validateGlobalAccess(auth);
    if (!access.ok) return access;

    const result = await this.model.archiveAndDelete({
      id,
      reason: input.reason.trim(),
      actorUserId: auth.userId,
      actorCid: auth.cid,
      requestId: input.requestId
    });

    if (result.status === 'not_found') {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'MYMOPH_USER_NOT_FOUND' } as const;
    }

    if (result.status === 'conflict') {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'MYMOPH_USER_DELETE_CONFLICT' } as const;
    }

    return {
      ok: true,
      status: StatusCodes.OK,
      data: { archiveId: result.archiveId }
    } as const;
  }

  private validateGlobalAccess(auth: AuthContext) {
    if (auth.scopeType === 'ALL' || auth.roles.includes('user_mymoph')) {
      return { ok: true } as const;
    }

    return { ok: false, status: StatusCodes.FORBIDDEN, error: 'GLOBAL_SCOPE_REQUIRED' } as const;
  }

  private maskCid(rawCid?: string): string {
    const cid = String(rawCid ?? '').trim();
    if (cid.length !== 13) return cid ? '*************' : '';
    return `${cid.slice(0, 8)}****${cid.slice(12)}`;
  }

  private normalizeKycStatus(rawStatus?: string): 'Y' | 'N' | 'UNKNOWN' {
    const status = String(rawStatus ?? '').trim().toUpperCase();
    if (status === 'Y') return 'Y';
    if (status === 'N') return 'N';
    return 'UNKNOWN';
  }
}
