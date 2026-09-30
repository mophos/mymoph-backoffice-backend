import type { Knex } from 'knex';
import { HCODE_TABLE } from '../../shared/services/hcode-bridge.service';

export interface SearchInput {
  search?: string;
  provinceCode?: string;
  /** true = เฉพาะที่ยังเปิดทำการ ค่าเริ่มต้นคือ true */
  activeOnly: boolean;
  pageSize: number;
  offset: number;
}

export class HealthOfficesModel {
  constructor(private readonly db: Knex) {}

  async search(input: SearchInput) {
    const base = this.db(HCODE_TABLE);

    if (input.activeOnly) {
      base.where('active', 1);
    }

    if (input.provinceCode) {
      base.where('addr_province_code', input.provinceCode);
    }

    if (input.search) {
      const term = input.search.trim();
      base.where((builder) => {
        // ค้นด้วยรหัสให้แมตช์แบบขึ้นต้น ส่วนชื่อให้แมตช์แบบมีคำนั้นอยู่
        builder
          .where('hcode9', 'like', `${term}%`)
          .orWhere('code5', 'like', `${term}%`)
          .orWhere('name', 'like', `%${term}%`);
      });
    }

    const [{ total }] = await base
      .clone()
      .count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select(
        'hcode9',
        'code5',
        'name',
        'health_office_type as officeType',
        'addr_province as province',
        'addr_province_code as provinceCode',
        'addr_district as district',
        'active'
      )
      // เรียงตามชื่อเพื่อให้ผลค้นหาคาดเดาได้ ไม่ขึ้นกับลำดับในตาราง
      .orderBy('name', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      total: Number(total ?? 0),
      rows: rows.map((row) => ({
        hcode9: String(row.hcode9),
        // null แปลว่าหน่วยงานนี้ไม่มีรหัส 5 หลัก ฟีเจอร์ที่ผูกกับฝั่ง MyMOPH จะใช้ไม่ได้
        code5: row.code5 ? String(row.code5).trim() || null : null,
        name: String(row.name ?? ''),
        officeType: row.officeType ? String(row.officeType) : null,
        province: row.province ? String(row.province) : null,
        provinceCode: row.provinceCode ? String(row.provinceCode) : null,
        district: row.district ? String(row.district) : null,
        active: Number(row.active) === 1
      }))
    };
  }

  /** ดึงรายละเอียดของรหัสที่ระบุ ใช้แสดงชื่อของค่าที่บันทึกไว้แล้ว */
  async findByCodes(input: { hcode9?: string[]; code5?: string[] }) {
    const codes9 = input.hcode9?.filter(Boolean) ?? [];
    const codes5 = input.code5?.filter(Boolean) ?? [];
    if (!codes9.length && !codes5.length) return [];

    const rows = await this.db(HCODE_TABLE)
      .where((builder) => {
        if (codes9.length) builder.orWhereIn('hcode9', codes9);
        if (codes5.length) builder.orWhereIn('code5', codes5);
      })
      .select('hcode9', 'code5', 'name', 'addr_province as province', 'active');

    return rows.map((row) => ({
      hcode9: String(row.hcode9),
      code5: row.code5 ? String(row.code5).trim() || null : null,
      name: String(row.name ?? ''),
      province: row.province ? String(row.province) : null,
      active: Number(row.active) === 1
    }));
  }
}
