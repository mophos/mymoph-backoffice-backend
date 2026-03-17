import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { OfficeSettingsModel } from './office-settings.model';

interface ListOfficeSettingsQuery {
  search?: string;
  isActive?: 0 | 1;
  page: number;
  pageSize: number;
  offset: number;
  effectiveHospcodes: string[];
}

interface CreateOfficeInput {
  hospcode: string;
  name: string;
  province_code?: string | null;
  is_active?: 0 | 1;
}

interface UpdateOfficeInput {
  name?: string;
  province_code?: string | null;
  is_active?: 0 | 1;
}

export class OfficeSettingsService {
  constructor(private readonly model: OfficeSettingsModel) {}

  async list(auth: AuthContext, query: ListOfficeSettingsQuery) {
    const data = await this.model.list({
      search: query.search,
      isActive: query.isActive,
      scopeType: auth.scopeType,
      hospcodes: auth.scopeType === 'ALL' ? query.effectiveHospcodes : auth.hospcodes,
      pageSize: query.pageSize,
      offset: query.offset
    });

    return {
      ...data,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async create(auth: AuthContext, payload: CreateOfficeInput) {
    const validation = this.validateScope(auth, payload.hospcode);
    if (!validation.ok) return validation;

    const existing = await this.model.findByHospcode(payload.hospcode);
    if (existing) {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'HOSPCODE_ALREADY_EXISTS' };
    }

    await this.model.create({
      ...payload,
      is_active: payload.is_active ?? 1
    });

    return { ok: true, status: StatusCodes.CREATED };
  }

  async update(auth: AuthContext, hospcode: string, payload: UpdateOfficeInput) {
    const validation = this.validateScope(auth, hospcode);
    if (!validation.ok) return validation;

    const existing = await this.model.findByHospcode(hospcode);
    if (!existing) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'ORGANIZATION_NOT_FOUND' };
    }

    await this.model.updateByHospcode(hospcode, payload);
    return { ok: true, status: StatusCodes.OK };
  }

  async delete(auth: AuthContext, hospcode: string) {
    const validation = this.validateScope(auth, hospcode);
    if (!validation.ok) return validation;

    const existing = await this.model.findByHospcode(hospcode);
    if (!existing) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'ORGANIZATION_NOT_FOUND' };
    }

    await this.model.softDeleteByHospcode(hospcode);
    return { ok: true, status: StatusCodes.OK };
  }

  async registerCheckinOffice(auth: AuthContext, hospcode: string) {
    const validation = this.validateScope(auth, hospcode);
    if (!validation.ok) return validation;

    const existing = await this.model.findByHospcode(hospcode);
    if (!existing) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'ORGANIZATION_NOT_FOUND' };
    }

    try {
      const result = await this.model.registerCheckinOffice(hospcode);
      return {
        ok: true,
        status: StatusCodes.OK,
        data: result
      };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : '';
      if (
        errorCode === 'CHECKIN_OFFICE_TABLE_NOT_FOUND' ||
        errorCode === 'CHECKIN_OFFICE_TABLE_INVALID'
      ) {
        return { ok: false, status: StatusCodes.INTERNAL_SERVER_ERROR, error: errorCode };
      }

      throw error;
    }
  }

  private validateScope(auth: AuthContext, hospcode: string) {
    if (auth.scopeType === 'ALL') {
      return { ok: true };
    }

    if (auth.hospcodes.includes(hospcode)) {
      return { ok: true };
    }

    return { ok: false, status: StatusCodes.FORBIDDEN, error: 'SCOPE_FORBIDDEN' };
  }
}
