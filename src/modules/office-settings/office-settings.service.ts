import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { OfficeSettingsModel } from './office-settings.model';

export class OfficeSettingsService {
  constructor(private readonly model: OfficeSettingsModel) {}

  async list(auth: AuthContext, query: {
    search?: string;
    provinceCode?: string;
    checkinStatus?: 'Y' | 'N';
    page: number;
    pageSize: number;
    offset: number;
  }) {
    const data = await this.model.list({
      search: query.search,
      provinceCode: query.provinceCode,
      checkinStatus: query.checkinStatus,
      scopeType: auth.scopeType,
      hospcodes: auth.hospcodes,
      pageSize: query.pageSize,
      offset: query.offset
    });

    return {
      ok: true as const,
      status: StatusCodes.OK,
      data: { ...data, page: query.page, pageSize: query.pageSize }
    };
  }

  /** เปิดหรือปิดการลงเวลาของหน่วยงาน รับรหัสได้ทั้ง hcode9 และ code5 */
  async setCheckin(auth: AuthContext, code: string, status: 'Y' | 'N') {
    const office = await this.model.findOffice(code);
    if (!office) {
      return { ok: false as const, status: StatusCodes.NOT_FOUND, error: 'HOSPCODE_NOT_FOUND' };
    }

    const scopeCheck = this.validateScope(auth, office.code5);
    if (!scopeCheck.ok) return scopeCheck;

    try {
      const result = await this.model.setCheckinStatus({
        code5: office.code5,
        hcode9: office.hcode9,
        status
      });

      return {
        ok: true as const,
        status: StatusCodes.OK,
        data: { ...office, checkinStatus: result.status, changed: result.changed }
      };
    } catch (error) {
      const name = error instanceof Error ? error.message : '';
      if (name === 'CHECKIN_OFFICE_TABLE_NOT_FOUND' || name === 'CHECKIN_OFFICE_TABLE_INVALID') {
        return { ok: false as const, status: StatusCodes.SERVICE_UNAVAILABLE, error: name };
      }
      throw error;
    }
  }

  private validateScope(auth: AuthContext, code5: string | null) {
    if (auth.scopeType === 'ALL') return { ok: true as const };

    /*
     * ขอบเขตของผู้ใช้ยังเก็บเป็น code5 หน่วยงานที่ไม่มีรหัสนั้นจึงไม่มีทางอยู่ใน
     * ขอบเขตของใครได้เลย มีเพียงผู้ที่มีขอบเขตทุกหน่วยงานที่เปิดให้ได้
     * เมื่อ migration เปลี่ยนขอบเขตไปเก็บ hcode9 แล้วข้อจำกัดนี้จะหายไปเอง
     */
    if (!code5 || !auth.hospcodes.includes(code5)) {
      return { ok: false as const, status: StatusCodes.FORBIDDEN, error: 'SCOPE_FORBIDDEN' };
    }

    return { ok: true as const };
  }
}
