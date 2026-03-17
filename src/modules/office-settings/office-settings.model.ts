import type { Knex } from 'knex';
import { config } from '../../config/env';

interface ListOfficeSettingsInput {
  search?: string;
  isActive?: 0 | 1;
  hospcodes: string[];
  scopeType: 'ALL' | 'LIST';
  pageSize: number;
  offset: number;
}

interface CreateOfficeInput {
  hospcode: string;
  name: string;
  province_code?: string | null;
  is_active: 0 | 1;
}

interface UpdateOfficeInput {
  name?: string;
  province_code?: string | null;
  is_active?: 0 | 1;
}

interface CheckinOfficeTableMeta {
  exists: boolean;
  hasHospcode: boolean;
  hasStatus: boolean;
}

export class OfficeSettingsModel {
  private checkinOfficeTableMetaPromise?: Promise<CheckinOfficeTableMeta>;

  constructor(
    private readonly db: Knex,
    private readonly mymophDb: Knex
  ) {}

  async list(input: ListOfficeSettingsInput) {
    const base = this.db('organizations as o');

    if (input.scopeType === 'LIST') {
      base.whereIn('o.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.search) {
      base.andWhere((builder) => {
        builder
          .where('o.hospcode', 'like', `%${input.search}%`)
          .orWhere('o.name', 'like', `%${input.search}%`)
          .orWhere('o.province_code', 'like', `%${input.search}%`);
      });
    }

    if (typeof input.isActive === 'number') {
      base.andWhere('o.is_active', input.isActive);
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select('o.hospcode', 'o.name', 'o.province_code', 'o.is_active', 'o.updated_at')
      .orderBy('o.updated_at', 'desc')
      .orderBy('o.hospcode', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    const registrationMap = await this.getCheckinRegistrationByHospcodes(
      rows.map((row) => String(row.hospcode))
    );

    const normalizedRows = rows.map((row) => {
      const checkinStatus = registrationMap.get(String(row.hospcode)) ?? 'N';
      return {
        ...row,
        checkin_status: checkinStatus,
        is_checkin_registered: checkinStatus === 'Y' ? 1 : 0
      };
    });

    return {
      total: Number(total ?? 0),
      rows: normalizedRows
    };
  }

  async findByHospcode(hospcode: string) {
    return this.db('organizations').where({ hospcode }).first();
  }

  async create(input: CreateOfficeInput) {
    await this.db('organizations').insert({
      hospcode: input.hospcode,
      name: input.name,
      province_code: input.province_code ?? null,
      is_active: input.is_active,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    });
  }

  async updateByHospcode(hospcode: string, payload: UpdateOfficeInput) {
    await this.db('organizations')
      .where({ hospcode })
      .update({
        ...payload,
        updated_at: this.db.fn.now()
      });
  }

  async softDeleteByHospcode(hospcode: string) {
    await this.db('organizations')
      .where({ hospcode })
      .update({
        is_active: 0,
        updated_at: this.db.fn.now()
      });
  }

  async registerCheckinOffice(hospcode: string) {
    const tableMeta = await this.getCheckinOfficeTableMeta();
    if (!tableMeta.exists) {
      throw new Error('CHECKIN_OFFICE_TABLE_NOT_FOUND');
    }
    if (!tableMeta.hasHospcode || !tableMeta.hasStatus) {
      throw new Error('CHECKIN_OFFICE_TABLE_INVALID');
    }

    const tableName = config.mymophTables.checkinOffices;
    const existing = await this.mymophDb(tableName)
      .select('hospcode', 'status')
      .where({ hospcode })
      .first();

    const existingStatus = this.normalizeStatus(existing?.status);
    if (existing && existingStatus === 'Y') {
      return { hospcode, status: 'Y' as const, alreadyRegistered: true };
    }

    if (existing) {
      await this.mymophDb(tableName).where({ hospcode }).update({ status: 'Y' });
    } else {
      await this.mymophDb(tableName).insert({
        hospcode,
        status: 'Y'
      });
    }

    return { hospcode, status: 'Y' as const, alreadyRegistered: false };
  }

  private async getCheckinRegistrationByHospcodes(hospcodes: string[]) {
    const map = new Map<string, 'Y' | 'N'>();
    if (!hospcodes.length) {
      return map;
    }

    const tableMeta = await this.getCheckinOfficeTableMeta();
    if (!tableMeta.exists || !tableMeta.hasHospcode || !tableMeta.hasStatus) {
      return map;
    }

    const rows = await this.mymophDb(`${config.mymophTables.checkinOffices} as c`)
      .select('c.hospcode', 'c.status')
      .whereIn('c.hospcode', hospcodes);

    for (const row of rows) {
      const hospcode = String(row.hospcode ?? '');
      if (!hospcode) continue;

      const status = this.normalizeStatus(row.status);
      const current = map.get(hospcode) ?? 'N';
      if (status === 'Y' || current !== 'Y') {
        map.set(hospcode, status);
      }
    }

    return map;
  }

  private async getCheckinOfficeTableMeta(): Promise<CheckinOfficeTableMeta> {
    if (!this.checkinOfficeTableMetaPromise) {
      this.checkinOfficeTableMetaPromise = this.loadCheckinOfficeTableMeta();
    }

    return this.checkinOfficeTableMetaPromise;
  }

  private async loadCheckinOfficeTableMeta(): Promise<CheckinOfficeTableMeta> {
    const rows = await this.mymophDb('information_schema.columns')
      .select('COLUMN_NAME as column_name')
      .whereRaw('TABLE_SCHEMA = DATABASE()')
      .andWhere('TABLE_NAME', config.mymophTables.checkinOffices);

    const columnNames = new Set<string>(rows.map((row) => String(row.column_name).toLowerCase()));

    return {
      exists: rows.length > 0,
      hasHospcode: columnNames.has('hospcode'),
      hasStatus: columnNames.has('status')
    };
  }

  private normalizeStatus(status: unknown): 'Y' | 'N' {
    return String(status ?? '').toUpperCase() === 'Y' ? 'Y' : 'N';
  }
}
