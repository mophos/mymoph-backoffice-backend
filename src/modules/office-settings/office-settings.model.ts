import type { Knex } from 'knex';
import { config } from '../../config/env';
import { HCODE_TABLE } from '../../shared/services/hcode-bridge.service';

export interface ListInput {
  search?: string;
  provinceCode?: string;
  /** กรองตามสถานะลงเวลา 'Y' = เปิดแล้ว 'N' = ยังไม่เปิด */
  checkinStatus?: 'Y' | 'N';
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
  pageSize: number;
  offset: number;
}

interface CheckinTableMeta {
  exists: boolean;
  hasHospcode: boolean;
  hasHospcode9: boolean;
  hasStatus: boolean;
}

/**
 * โมดูลนี้เปลี่ยนบทบาทเมื่อ 25 กันยายน 2569
 *
 * เดิมทำ CRUD บนตาราง organizations ที่กรอกมือ 104 แถว
 * ตอนนี้ทะเบียนหน่วยงานมาจาก hcode_health_office ที่ cron ของอีกระบบ upsert ทุกวัน
 * จึงแก้ไขจากที่นี่ไม่ได้ (การแก้จะหายทุกวัน) เหลือหน้าที่สองอย่างคือ
 * เรียกดูทะเบียน และคุมว่าหน่วยงานไหนเปิดใช้การลงเวลา
 *
 * ดู work-list/work-clear-bug-repair/11-HCODE-MIGRATION.md
 */
export class OfficeSettingsModel {
  private checkinMetaPromise: Promise<CheckinTableMeta> | null = null;

  constructor(
    private readonly db: Knex,
    private readonly mymophDb: Knex
  ) {}

  async list(input: ListInput) {
    const base = this.db(`${HCODE_TABLE} as h`).where('h.active', 1);

    // คงพฤติกรรมสิทธิ์เดิม: ผู้มี Scope LIST เห็นเฉพาะหน่วยงานที่ตัวเองดูแล
    // ข้อมูลในระบบยังเก็บ code5 จึงกรองด้วยคอลัมน์นั้น
    if (input.scopeType === 'LIST') {
      base.whereIn('h.code5', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.provinceCode) {
      base.andWhere('h.addr_province_code', input.provinceCode);
    }

    if (input.search) {
      const term = input.search.trim();
      base.andWhere((builder) => {
        builder
          .where('h.hcode9', 'like', `${term}%`)
          .orWhere('h.code5', 'like', `${term}%`)
          .orWhere('h.name', 'like', `%${term}%`);
      });
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select(
        'h.hcode9',
        'h.code5',
        'h.name',
        'h.health_office_type as officeType',
        'h.addr_province as province',
        'h.addr_province_code as provinceCode',
        'h.addr_district as district'
      )
      .orderBy('h.name', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    // สถานะลงเวลาอยู่ในฐาน MyMOPH และยังอ้างอิงด้วย code5
    const statusMap = await this.getCheckinStatus(
      rows.map((row) => ({
        code5: String(row.code5 ?? '').trim() || null,
        hcode9: String(row.hcode9)
      }))
    );

    const mapped = rows.map((row) => {
      const code5 = row.code5 ? String(row.code5).trim() : null;
      return {
        hcode9: String(row.hcode9),
        code5,
        name: String(row.name ?? ''),
        officeType: row.officeType ? String(row.officeType) : null,
        province: row.province ? String(row.province) : null,
        provinceCode: row.provinceCode ? String(row.provinceCode) : null,
        district: row.district ? String(row.district) : null,
        checkinStatus: statusMap.get(String(row.hcode9)) ?? 'N',
        /**
         * หน่วยงานที่ไม่มี code5 เปิดได้ แต่แอป MyMOPH ยังอ่าน hospcode (code5) อยู่
         * จึงยังใช้งานจริงไม่ได้จนกว่าแอปจะรองรับ hospcode9
         */
        requiresAppSupport: !code5
      };
    });

    const filtered = input.checkinStatus
      ? mapped.filter((row) => row.checkinStatus === input.checkinStatus)
      : mapped;

    return { total: Number(total ?? 0), rows: filtered };
  }

  /** หาหน่วยงานจากรหัส รับได้ทั้ง hcode9 และ code5 */
  async findOffice(code: string) {
    const row = await this.db(HCODE_TABLE)
      .where((builder) => {
        builder.where('hcode9', code).orWhere('code5', code);
      })
      .andWhere('active', 1)
      .orderBy('active', 'desc')
      .select('hcode9', 'code5', 'name')
      .first();

    if (!row) return null;

    return {
      hcode9: String(row.hcode9),
      code5: row.code5 ? String(row.code5).trim() || null : null,
      name: String(row.name ?? '')
    };
  }

  /**
   * ตั้งสถานะลงเวลาในฐาน MyMOPH
   *
   * เขียน hospcode (code5) เป็นหลักเพราะแอป MyMOPH อ่านคอลัมน์นั้น
   * และเขียน hospcode9 ด้วยถ้าตารางมีคอลัมน์นั้นแล้ว เพื่อเตรียมรองรับมาตรฐานใหม่
   */
  async setCheckinStatus(input: { code5: string | null; hcode9: string; status: 'Y' | 'N' }) {
    const meta = await this.getCheckinMeta();
    if (!meta.exists) throw new Error('CHECKIN_OFFICE_TABLE_NOT_FOUND');
    if (!meta.hasHospcode || !meta.hasStatus) throw new Error('CHECKIN_OFFICE_TABLE_INVALID');

    // หน่วยงานที่ไม่มี code5 อ้างอิงได้ด้วย hospcode9 เท่านั้น
    // ถ้าตารางยังไม่มีคอลัมน์นั้นก็เปิดให้ไม่ได้จริง
    if (!input.code5 && !meta.hasHospcode9) {
      throw new Error('CHECKIN_OFFICE_TABLE_INVALID');
    }

    const table = config.mymophTables.checkinOffices;

    const matchExisting = () => {
      const q = this.mymophDb(table);
      if (input.code5) {
        q.where({ hospcode: input.code5 });
      } else {
        q.where({ hospcode9: input.hcode9 });
      }
      return q;
    };

    const existing = await matchExisting().select('status').first();
    const current = this.normalizeStatus(existing?.status);
    if (existing && current === input.status) {
      return { status: input.status, changed: false };
    }

    const payload: Record<string, unknown> = { status: input.status };
    if (meta.hasHospcode9) payload.hospcode9 = input.hcode9;

    if (existing) {
      await matchExisting().update(payload);
    } else {
      await this.mymophDb(table).insert({ hospcode: input.code5, ...payload });
    }

    return { status: input.status, changed: true };
  }

  /**
   * คืนสถานะโดยคีย์เป็น hcode9
   *
   * ต้องจับคู่ทั้ง hospcode (code5) และ hospcode9 เพราะช่วงเปลี่ยนผ่านนี้
   * มีทั้งแถวเก่าที่มีแต่ code5 และแถวใหม่ของหน่วยงานที่ไม่มี code5
   */
  private async getCheckinStatus(
    offices: { code5: string | null; hcode9: string }[]
  ): Promise<Map<string, 'Y' | 'N'>> {
    const map = new Map<string, 'Y' | 'N'>();
    if (!offices.length) return map;

    const meta = await this.getCheckinMeta();
    if (!meta.exists || !meta.hasHospcode || !meta.hasStatus) return map;

    const code5List = offices.map((o) => o.code5).filter((c): c is string => !!c);
    const hcode9List = offices.map((o) => o.hcode9);

    const query = this.mymophDb(config.mymophTables.checkinOffices).select('hospcode', 'status');
    if (meta.hasHospcode9) query.select('hospcode9');

    const rows = await query.where((builder) => {
      if (code5List.length) builder.orWhereIn('hospcode', code5List);
      if (meta.hasHospcode9) builder.orWhereIn('hospcode9', hcode9List);
    });

    const byCode5 = new Map<string, string>();
    for (const office of offices) {
      if (office.code5) byCode5.set(office.code5, office.hcode9);
    }

    for (const row of rows) {
      const rowCode5 = String(row.hospcode ?? '').trim();
      const rowHcode9 = String((row as { hospcode9?: unknown }).hospcode9 ?? '').trim();
      const key = rowHcode9 || byCode5.get(rowCode5) || '';
      if (!key) continue;

      const status = this.normalizeStatus(row.status);
      // ตารางนี้ไม่มี unique key จึงอาจมีหลายแถวต่อหนึ่งหน่วยงาน ถือว่าเปิดถ้ามีแถวใดเป็น Y
      if (status === 'Y' || (map.get(key) ?? 'N') !== 'Y') {
        map.set(key, status);
      }
    }

    return map;
  }

  private normalizeStatus(value: unknown): 'Y' | 'N' {
    return String(value ?? '').trim().toUpperCase() === 'Y' ? 'Y' : 'N';
  }

  private async getCheckinMeta(): Promise<CheckinTableMeta> {
    if (!this.checkinMetaPromise) {
      this.checkinMetaPromise = this.loadCheckinMeta();
    }
    return this.checkinMetaPromise;
  }

  private async loadCheckinMeta(): Promise<CheckinTableMeta> {
    const table = config.mymophTables.checkinOffices;
    const rows = await this.mymophDb('information_schema.columns')
      .select('COLUMN_NAME as name')
      .where('TABLE_SCHEMA', this.mymophDb.client.database())
      .andWhere('TABLE_NAME', table);

    const names = new Set(rows.map((row) => String(row.name).toLowerCase()));
    return {
      exists: names.size > 0,
      hasHospcode: names.has('hospcode'),
      hasHospcode9: names.has('hospcode9'),
      hasStatus: names.has('status')
    };
  }
}
