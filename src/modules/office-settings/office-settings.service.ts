import { StatusCodes } from 'http-status-codes';
import type { AuthContext } from '../../shared/types/auth';
import { OfficeSettingsModel } from './office-settings.model';
import { officeReferenceCode } from '../../shared/services/hcode-bridge.service';

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

    const scopeCheck = this.validateScope(auth, office);
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

  private validateScope(auth: AuthContext, office: { code5: string | null; hcode9: string }) {
    if (auth.scopeType === 'ALL') return { ok: true as const };

    /*
     * ขอบเขตเก็บเป็น "รหัสอ้างอิง" คือ code5 ถ้ามี ไม่มีก็ hcode9 (H-01)
     *
     * คอมเมนต์เดิมตรงนี้เขียนไว้ว่าหน่วยงานที่ไม่มี code5 จะไม่มีทางอยู่ในขอบเขตของใคร
     * และข้อจำกัดจะหายไปเองเมื่อขอบเขตเปลี่ยนไปเก็บ hcode9 — ซึ่งเกิดขึ้นแล้ว
     */
    if (!auth.hospcodes.includes(officeReferenceCode(office))) {
      return { ok: false as const, status: StatusCodes.FORBIDDEN, error: 'SCOPE_FORBIDDEN' };
    }

    return { ok: true as const };
  }
}
