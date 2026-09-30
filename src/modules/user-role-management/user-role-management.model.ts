import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { HCODE_TABLE } from '../../shared/services/hcode-bridge.service';

/** คู่รหัสของหน่วยงานหนึ่งแห่งตามทะเบียนกลาง */
export interface OfficeCode {
  /** null เมื่อหน่วยงานยังไม่มีรหัส 5 หลัก พบมากในสถานพยาบาลเอกชน */
  code5: string | null;
  hcode9: string;
}

interface ScopeTableMeta {
  hasHospcode9: boolean;
}

interface ListInput {
  search?: string;
  roleCode?: string;
  actorScopeType: 'ALL' | 'LIST';
  actorHospcodes: string[];
  page: number;
  pageSize: number;
  offset: number;
}

export class UserRoleManagementModel {
  private scopeMetaPromise: Promise<ScopeTableMeta> | null = null;

  constructor(private readonly db: Knex) {}

  async listHrOfficeAdmins(input: ListInput) {
    const base = this.db('user_roles as ur')
      .innerJoin('users as u', 'u.id', 'ur.user_id')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .where('ur.is_active', 1)
      .where('u.is_active', 1)
      .where('r.is_active', 1);

    if (input.roleCode) {
      base.andWhere('r.code', input.roleCode);
    }

    if (input.search) {
      base.andWhere((builder) => {
        builder
          .where('u.cid', 'like', `%${input.search}%`)
          .orWhere('u.first_name', 'like', `%${input.search}%`)
          .orWhere('u.last_name', 'like', `%${input.search}%`)
          .orWhere('u.email', 'like', `%${input.search}%`);
      });
    }

    if (input.actorScopeType === 'LIST') {
      base.whereExists((subquery) => {
        subquery
          .select(this.db.raw('1'))
          .from('user_office_scope as uos')
          .whereRaw('uos.user_id = ur.user_id')
          .where('uos.is_active', 1)
          .whereIn('uos.hospcode', input.actorHospcodes.length ? input.actorHospcodes : ['']);
      });
    }

    const [{ total }] = await base.clone().countDistinct<{ total: number }[]>({ total: 'ur.user_id' });

    const userRows = await base
      .clone()
      .select('ur.user_id')
      .max<{ user_id: string; latest_assigned_at: string }[]>({ latest_assigned_at: 'ur.created_at' })
      .groupBy('ur.user_id')
      .orderBy('latest_assigned_at', 'desc')
      .limit(input.pageSize)
      .offset(input.offset);

    const userIds = userRows.map((row) => String(row.user_id));
    if (!userIds.length) {
      return {
        total: Number(total ?? 0),
        rows: []
      };
    }

    const rows = await this.db('user_roles as ur')
      .innerJoin('users as u', 'u.id', 'ur.user_id')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .where('ur.is_active', 1)
      .where('u.is_active', 1)
      .where('r.is_active', 1)
      .whereIn('ur.user_id', userIds)
      .modify((queryBuilder) => {
        if (input.roleCode) {
          queryBuilder.andWhere('r.code', input.roleCode);
        }
      })
      .select(
        'u.id as user_id',
        'u.cid',
        'u.first_name',
        'u.last_name',
        'u.email',
        'r.code as role_code',
        'r.name as role_name',
        'ur.created_at as assigned_at'
      )
      .orderBy('ur.created_at', 'desc');

    const scopeRows = userIds.length
      ? await this.db('user_office_scope')
          .select('user_id', 'hospcode')
          .whereIn('user_id', userIds)
          .where('is_active', 1)
      : [];

    const scopeMap = new Map<string, string[]>();
    for (const row of scopeRows) {
      const list = scopeMap.get(row.user_id) ?? [];
      list.push(row.hospcode);
      scopeMap.set(row.user_id, list);
    }

    // แนบชื่อและ hcode9 จากทะเบียนกลาง เพื่อให้หน้าเว็บแสดงชื่อหน่วยงานแทนรหัสเปล่า
    // ค่าที่เก็บใน user_office_scope ยังเป็น code5 จึง join ด้วยคอลัมน์นั้น
    const allHospcodes = [...new Set(scopeRows.map((row) => String(row.hospcode)))];
    const officeRows = allHospcodes.length
      ? await this.db(`${HCODE_TABLE} as h`)
          .whereIn('h.code5', allHospcodes)
          .select('h.code5', 'h.hcode9', 'h.name', 'h.active')
          // code5 ซ้ำได้ 3 คู่ เอาแถวที่ยัง active ไว้ก่อน
          .orderBy([{ column: 'h.active', order: 'desc' }])
      : [];

    const officeMap = new Map<string, { code5: string; hcode9: string; name: string }>();
    for (const row of officeRows) {
      const code5 = String(row.code5).trim();
      if (!officeMap.has(code5)) {
        officeMap.set(code5, { code5, hcode9: String(row.hcode9), name: String(row.name ?? '') });
      }
    }

    const officesFor = (userId: string) =>
      (scopeMap.get(userId) ?? []).map((code) =>
        officeMap.get(code) ?? { code5: code, hcode9: '', name: '' }
      );

    const grouped = new Map<
      string,
      {
        user_id: string;
        cid: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        role_codes: string[];
        hospcodes: string[];
        /** ข้อมูลหน่วยงานจากทะเบียนกลาง hcode_health_office */
        offices: { code5: string; hcode9: string; name: string }[];
        latest_assigned_at: string;
      }
    >();

    for (const row of rows) {
      const userId = String(row.user_id);
      const current = grouped.get(userId) ?? {
        user_id: userId,
        cid: String(row.cid ?? ''),
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        email: row.email ?? null,
        role_codes: [] as string[],
        hospcodes: (scopeMap.get(userId) ?? []) as string[],
        offices: officesFor(userId),
        latest_assigned_at: String(row.assigned_at ?? '')
      };

      const roleCode = String(row.role_code ?? '').trim();
      if (roleCode && !current.role_codes.includes(roleCode)) {
        current.role_codes.push(roleCode);
      }

      if (String(row.assigned_at ?? '') > current.latest_assigned_at) {
        current.latest_assigned_at = String(row.assigned_at ?? '');
      }

      grouped.set(userId, current);
    }

    const userOrder = new Map<string, number>();
    userIds.forEach((userId, index) => {
      userOrder.set(userId, index);
    });

    const normalized = [...grouped.values()]
      .sort((left, right) => (userOrder.get(left.user_id) ?? 0) - (userOrder.get(right.user_id) ?? 0))
      .map((item) => ({
        user_id: item.user_id,
        cid: item.cid,
        first_name: item.first_name,
        last_name: item.last_name,
        email: item.email,
        role_codes: item.role_codes,
        hospcodes: item.hospcodes,
        offices: item.offices
      }));

    return {
      total: Number(total ?? 0),
      rows: normalized
    };
  }

  async getRoleByCode(code: string) {
    return this.db('roles').where({ code, is_active: 1 }).first();
  }

  async getRolesByCodes(codes: string[]) {
    if (!codes.length) return [];
    return this.db('roles')
      .whereIn('code', codes)
      .where({ is_active: 1 })
      .select('id', 'code', 'name');
  }

  /**
   * ตรวจว่ารหัสหน่วยงานมีอยู่จริงในทะเบียนกลาง
   *
   * รับได้ทั้ง code5 และ hcode9 ตามหลัก "liberal ตอนรับ strict ตอนเก็บ"
   * ใน 11-HCODE-MIGRATION.md เพื่อให้ frontend ทยอยเปลี่ยนไปส่ง hcode9 ได้
   * โดยไม่ต้องรอ backend เปลี่ยนพร้อมกัน
   *
   * คืนค่ากลับเป็นรูปแบบเดียวกับที่รับเข้ามา เพื่อให้ผู้เรียกเทียบได้ตรง
   */
  /** หน่วยงานที่บัญชีเป้าหมายรับผิดชอบอยู่จริง ใช้ตรวจว่าผู้กระทำมีสิทธิ์แตะบัญชีนี้ไหม */
  async getActiveScopes(userId: string): Promise<string[]> {
    const rows = await this.db('user_office_scope')
      .where({ user_id: userId, is_active: 1 })
      .select('hospcode');

    return rows.map((row) => String(row.hospcode));
  }

  /**
   * แปลงรหัสที่รับเข้ามาให้เป็นคู่ code5/hcode9 ตามทะเบียนกลาง
   *
   * รับได้ทั้งสองแบบเพราะหน้าเว็บกำลังทยอยเปลี่ยนไปแสดง hcode9
   * รหัสที่หาไม่เจอจะไม่อยู่ใน Map ผู้เรียกต้องถือว่าเป็นรหัสผิด
   *
   * code5 บางตัวชี้ไปหลาย hcode9 (ทะเบียนมีซ้ำอยู่ 3 คู่) จึงเรียงแบบเดียวกับ
   * HcodeBridgeService คือเอาแถวที่ active และแก้ไขล่าสุดก่อน เพื่อให้ได้ผลเท่ากันทุกที่
   */
  async resolveOfficeCodes(codes: string[]): Promise<Map<string, OfficeCode>> {
    const wanted = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (!wanted.length) return new Map();

    const rows = await this.db(HCODE_TABLE)
      .where((builder) => {
        builder.whereIn('code5', wanted).orWhereIn('hcode9', wanted);
      })
      .select('code5', 'hcode9', 'active', 'modified_date')
      .orderBy([
        { column: 'active', order: 'desc' },
        { column: 'modified_date', order: 'desc' }
      ]);

    const resolved = new Map<string, OfficeCode>();
    for (const row of rows) {
      const code5 = row.code5 ? String(row.code5).trim() : '';
      const office: OfficeCode = { code5: code5 || null, hcode9: String(row.hcode9).trim() };

      // แถวแรกที่เจอชนะ เพราะเรียงมาแล้ว
      if (code5 && !resolved.has(code5)) resolved.set(code5, office);
      if (!resolved.has(office.hcode9)) resolved.set(office.hcode9, office);
    }

    return new Map(wanted.filter((code) => resolved.has(code)).map((code) => [code, resolved.get(code)!]));
  }


  async getUserById(userId: string) {
    return this.db('users').where({ id: userId }).first();
  }

  async upsertUserByCid(input: {
    cid: string;
    createdBy?: string;
  }) {
    const existing = await this.db('users').where({ cid: input.cid }).first();

    if (existing) {
      await this.db('users').where({ id: existing.id }).update({
        is_active: 1,
        updated_at: this.db.fn.now()
      });

      return { id: existing.id, cid: input.cid };
    }

    const id = uuidv4();
    await this.db('users').insert({
      id,
      cid: input.cid,
      first_name: null,
      last_name: null,
      email: null,
      is_active: 1,
      created_by: input.createdBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });

    return { id, cid: input.cid };
  }

  async upsertUserRole(input: { userId: string; roleId: string; assignedBy?: string }) {
    const existing = await this.db('user_roles')
      .where({ user_id: input.userId, role_id: input.roleId })
      .first();

    if (existing) {
      await this.db('user_roles').where({ id: existing.id }).update({
        is_active: 1,
        assigned_by: input.assignedBy ?? null,
        updated_at: this.db.fn.now()
      });
      return;
    }

    await this.db('user_roles').insert({
      id: uuidv4(),
      user_id: input.userId,
      role_id: input.roleId,
      is_active: 1,
      assigned_by: input.assignedBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });
  }

  async syncUserRoles(input: { userId: string; roleIds: string[]; assignedBy?: string }) {
    const targetRoleIds = [...new Set(input.roleIds)];

    await this.db.transaction(async (trx) => {
      await trx('user_roles')
        .where('user_id', input.userId)
        .where('is_active', 1)
        .whereNotIn('role_id', targetRoleIds)
        .update({
          is_active: 0,
          assigned_by: input.assignedBy ?? null,
          updated_at: trx.fn.now()
        });

      for (const roleId of targetRoleIds) {
        const existing = await trx('user_roles')
          .where({ user_id: input.userId, role_id: roleId })
          .first();

        if (existing) {
          await trx('user_roles').where({ id: existing.id }).update({
            is_active: 1,
            assigned_by: input.assignedBy ?? null,
            updated_at: trx.fn.now()
          });
          continue;
        }

        await trx('user_roles').insert({
          id: uuidv4(),
          user_id: input.userId,
          role_id: roleId,
          is_active: 1,
          assigned_by: input.assignedBy ?? null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      }
    });
  }

  /**
   * แทนที่ขอบเขตหน่วยงานทั้งชุดของบัญชีหนึ่ง
   *
   * hospcode (code5) ยังเป็นแหล่งความจริง เพราะทุกโมดูลกรองด้วยรหัสนั้น
   * hospcode9 เขียนคู่ไว้ให้ข้อมูลพร้อมก่อน จะได้สลับแหล่งความจริงได้
   * โดยไม่ต้องไล่เติมย้อนหลัง ถ้าคอลัมน์ยังไม่มีก็ข้ามไปเฉย ๆ
   */
  async replaceUserScopes(input: { userId: string; offices: OfficeCode[]; updatedBy?: string }) {
    const meta = await this.getScopeMeta();

    const unique = new Map<string, OfficeCode>();
    for (const office of input.offices) {
      const code5 = office.code5?.trim();
      if (!code5) continue; // ยังบันทึกหน่วยงานที่ไม่มี code5 ไม่ได้ ผู้เรียกต้องกันไว้ก่อน
      if (!unique.has(code5)) unique.set(code5, { code5, hcode9: String(office.hcode9).trim() });
    }

    await this.db.transaction(async (trx) => {
      await trx('user_office_scope')
        .where({ user_id: input.userId, is_active: 1 })
        .update({
          is_active: 0,
          updated_at: trx.fn.now(),
          updated_by: input.updatedBy ?? null
        });

      if (!unique.size) return;

      const rows = [...unique.values()].map((office) => ({
        id: uuidv4(),
        user_id: input.userId,
        hospcode: office.code5 as string,
        ...(meta.hasHospcode9 ? { hospcode9: office.hcode9 } : {}),
        is_active: 1,
        created_by: input.updatedBy ?? null,
        updated_by: input.updatedBy ?? null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      }));

      await trx('user_office_scope')
        .insert(rows)
        .onConflict(['user_id', 'hospcode'])
        .merge({
          is_active: 1,
          ...(meta.hasHospcode9 ? { hospcode9: trx.raw('VALUES(hospcode9)') } : {}),
          updated_at: trx.fn.now(),
          updated_by: input.updatedBy ?? null
        });
    });
  }

  /**
   * ตรวจครั้งเดียวว่าตารางมีคอลัมน์ hospcode9 แล้วหรือยัง
   * ทำแบบเดียวกับ OfficeSettingsModel เพื่อให้ deploy โค้ดกับ ALTER
   * ไม่ต้องเรียงลำดับกัน
   */
  private async getScopeMeta(): Promise<ScopeTableMeta> {
    if (!this.scopeMetaPromise) {
      this.scopeMetaPromise = this.db('information_schema.columns')
        .select('COLUMN_NAME as name')
        .where('TABLE_SCHEMA', this.db.client.database())
        .andWhere('TABLE_NAME', 'user_office_scope')
        .then((rows) => ({
          hasHospcode9: rows.some((row) => String(row.name).toLowerCase() === 'hospcode9')
        }));
    }
    return this.scopeMetaPromise;
  }


  /**
   * ปิดบทบาทของบัญชี แล้วคืนจำนวนบทบาทที่ยัง active เหลืออยู่
   *
   * แยกออกจากการล้างขอบเขต เพราะกฎว่าจะล้างเมื่อไหร่เป็นเรื่องของ service
   * ไม่ใช่ของชั้นเข้าถึงข้อมูล (ดู ADMIN-02)
   *
   * ทั้งการปิดและการนับอยู่ใน transaction เดียวกัน เพื่อไม่ให้มีคนแก้บทบาท
   * คั่นกลางจนได้ตัวเลขที่ไม่ตรงกับสถานะจริง
   */
  async deactivateUserRoles(input: { userId: string; roleCode?: string; updatedBy?: string }): Promise<number> {
    return this.db.transaction(async (trx) => {
      const targetRoleIds = trx('user_roles as ur')
        .innerJoin('roles as r', 'r.id', 'ur.role_id')
        .where('ur.user_id', input.userId)
        .where('ur.is_active', 1)
        .modify((builder) => {
          if (input.roleCode) builder.andWhere('r.code', input.roleCode);
        })
        .select('ur.id');

      const ids = (await targetRoleIds).map((row: { id: string }) => String(row.id));

      if (ids.length) {
        await trx('user_roles')
          .whereIn('id', ids)
          .update({
            is_active: 0,
            updated_at: trx.fn.now()
            // ADMIN-05: ไม่เขียนทับ assigned_by อีกต่อไป
            // ฟิลด์นี้ต้องคงความหมายว่า "ใครเป็นผู้มอบบทบาทนี้"
            // ส่วนผู้ที่กดปิดถูกบันทึกไว้ใน audit_logs อยู่แล้ว
          });
      }

      const [{ remaining }] = await trx('user_roles')
        .where({ user_id: input.userId, is_active: 1 })
        .count<{ remaining: number }[]>({ remaining: '*' });

      return Number(remaining ?? 0);
    });
  }

  /** ปิดขอบเขตหน่วยงานทั้งหมดของบัญชี ใช้เมื่อไม่เหลือบทบาทที่ใช้งานได้แล้ว */
  async deactivateUserScopes(input: { userId: string; updatedBy?: string }): Promise<void> {
    await this.db('user_office_scope')
      .where('user_id', input.userId)
      .where('is_active', 1)
      .update({
        is_active: 0,
        updated_at: this.db.fn.now(),
        updated_by: input.updatedBy ?? null
      });
  }

}
