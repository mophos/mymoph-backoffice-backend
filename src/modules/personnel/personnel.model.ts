import type { Knex } from 'knex';
import { HCODE_TABLE } from '../../shared/services/hcode-bridge.service';
import { v4 as uuidv4 } from 'uuid';

const PERSONNEL_TABLE = 'personnel_profiles';

interface ListPersonnelInput {
  search?: string;
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
  pageSize: number;
  offset: number;
}

interface CreatePersonnelInput {
  cid: string;
  firstName: string;
  lastName: string;
  hospcode: string;
  createdBy?: string;
}

interface UpdatePersonnelInput {
  cid?: string;
  firstName?: string;
  lastName?: string;
  hospcode?: string;
  updatedBy?: string;
}

export interface PersonnelUpsertRow {
  cid: string;
  firstName: string;
  lastName: string;
  hospcode: string;
}

export class PersonnelModel {
  constructor(private readonly db: Knex) {}

  /**
   * แปลงรหัสที่รับเข้ามา (code5 หรือ hcode9) ให้เป็นคู่รหัสตามทะเบียนกลาง
   *
   * รับเป็นชุดเพราะการอัปโหลด Excel มีหลายแถว ถ้าเรียกทีละแถวจะกลายเป็น N query
   * เรียงแบบเดียวกับ HcodeBridgeService เพราะ code5 บางตัวชี้ไปหลาย hcode9
   */
  async resolveOfficeCodes(codes: string[]): Promise<Map<string, { code5: string | null; hcode9: string }>> {
    const wanted = [...new Set(codes.map((code) => String(code ?? '').trim()).filter(Boolean))];
    if (!wanted.length) return new Map();

    const rows = await this.db(HCODE_TABLE)
      .where((builder) => {
        builder.whereIn('code5', wanted).orWhereIn('hcode9', wanted);
      })
      .andWhere('active', 1)
      .orderBy([{ column: 'modified_date', order: 'desc' }])
      .select('code5', 'hcode9');

    const resolved = new Map<string, { code5: string | null; hcode9: string }>();
    for (const row of rows) {
      const code5 = row.code5 ? String(row.code5).trim() : '';
      const office = { code5: code5 || null, hcode9: String(row.hcode9).trim() };
      if (code5 && !resolved.has(code5)) resolved.set(code5, office);
      if (!resolved.has(office.hcode9)) resolved.set(office.hcode9, office);
    }

    return new Map(wanted.filter((c) => resolved.has(c)).map((c) => [c, resolved.get(c)!]));
  }

  async list(input: ListPersonnelInput) {
    const base = this.db(`${PERSONNEL_TABLE} as p`).where('p.is_active', 1);

    if (input.scopeType === 'LIST') {
      base.whereIn('p.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.search) {
      base.andWhere((builder) => {
        builder
          .where('p.cid', 'like', `%${input.search}%`)
          .orWhere('p.first_name', 'like', `%${input.search}%`)
          .orWhere('p.last_name', 'like', `%${input.search}%`);
      });
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select('p.id', 'p.cid', 'p.first_name', 'p.last_name', 'p.hospcode', 'p.updated_at')
      .orderBy('p.updated_at', 'desc')
      .orderBy('p.cid', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      total: Number(total ?? 0),
      rows
    };
  }

  async findById(id: string) {
    return this.db(PERSONNEL_TABLE).where({ id }).first();
  }

  async findByCidHospcode(cid: string, hospcode: string) {
    return this.db(PERSONNEL_TABLE).where({ cid, hospcode }).first();
  }

  async create(input: CreatePersonnelInput) {
    const id = uuidv4();
    await this.db(PERSONNEL_TABLE).insert({
      id,
      cid: input.cid,
      first_name: input.firstName,
      last_name: input.lastName,
      hospcode: input.hospcode,
      is_active: 1,
      created_by: input.createdBy ?? null,
      updated_by: input.createdBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });

    return id;
  }

  async updateById(id: string, input: UpdatePersonnelInput) {
    const payload: Record<string, unknown> = {
      updated_at: this.db.fn.now(),
      updated_by: input.updatedBy ?? null
    };

    if (input.cid !== undefined) payload.cid = input.cid;
    if (input.firstName !== undefined) payload.first_name = input.firstName;
    if (input.lastName !== undefined) payload.last_name = input.lastName;
    if (input.hospcode !== undefined) payload.hospcode = input.hospcode;

    await this.db(PERSONNEL_TABLE).where({ id }).update(payload);
  }

  async softDeleteById(id: string, updatedBy?: string) {
    await this.db(PERSONNEL_TABLE)
      .where({ id })
      .update({
        is_active: 0,
        updated_by: updatedBy ?? null,
        updated_at: this.db.fn.now()
      });
  }

  async bulkUpsert(rows: PersonnelUpsertRow[], updatedBy?: string) {
    if (!rows.length) return;

    const payload = rows.map((row) => ({
      id: uuidv4(),
      cid: row.cid,
      first_name: row.firstName,
      last_name: row.lastName,
      hospcode: row.hospcode,
      is_active: 1,
      created_by: updatedBy ?? null,
      updated_by: updatedBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    }));

    await this.db(PERSONNEL_TABLE)
      .insert(payload)
      .onConflict(['cid', 'hospcode'])
      .merge({
        first_name: this.db.raw('VALUES(first_name)'),
        last_name: this.db.raw('VALUES(last_name)'),
        is_active: 1,
        updated_by: updatedBy ?? null,
        updated_at: this.db.fn.now()
      });
  }
}
