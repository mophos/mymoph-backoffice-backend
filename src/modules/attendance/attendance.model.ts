import type { Knex } from 'knex';
import { config } from '../../config/env';

interface AttendanceQueryInput {
  hospcodes: string[];
  scopeType: 'ALL' | 'LIST';
  from: string;
  to: string;
}

interface AttendanceRecordInput extends AttendanceQueryInput {
  page: number;
  pageSize: number;
  offset: number;
  search?: string;
}

interface AttendanceExportInput extends AttendanceQueryInput {
  search?: string;
}

interface AttendanceTableMeta {
  hasHospcode: boolean;
  hasUsersTable: boolean;
  hasUserFirstName: boolean;
  hasUserLastName: boolean;
  hasUserFname: boolean;
  hasUserLname: boolean;
}

export class AttendanceModel {
  private tableMetaPromise?: Promise<AttendanceTableMeta>;
  private readonly systemDb?: Knex;

  constructor(
    private readonly db: Knex,
    systemDb?: Knex
  ) {
    this.systemDb = systemDb;
  }

  async getDashboardSummary(input: AttendanceQueryInput) {
    const tableMeta = await this.getAttendanceTableMeta();
    const query = this.db(`${config.mymophTables.attendanceLogs} as a`)
      .select(
        this.db.raw('COUNT(*) AS total_records'),
        this.db.raw('SUM(CASE WHEN a.check_in_time IS NOT NULL THEN 1 ELSE 0 END) AS checked_in_count'),
        this.db.raw('SUM(CASE WHEN a.check_out_time IS NOT NULL THEN 1 ELSE 0 END) AS checked_out_count')
      )
      .whereBetween('a.attendance_date', [input.from, input.to]);

    if (input.scopeType === 'LIST') {
      if (tableMeta.hasHospcode) {
        query.whereIn('a.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
      } else {
        // Cannot enforce office scope without hospcode column; fail closed.
        query.whereRaw('1 = 0');
      }
    }

    const [row] = await query;
    return row;
  }

  async listAttendanceRecords(input: AttendanceRecordInput) {
    const tableMeta = await this.getAttendanceTableMeta();
    const base = this.db(`${config.mymophTables.attendanceLogs} as a`).whereBetween('a.attendance_date', [input.from, input.to]);

    if (tableMeta.hasUsersTable) {
      base.leftJoin('users as u', 'u.cid', 'a.cid');
    }

    if (input.scopeType === 'LIST') {
      if (tableMeta.hasHospcode) {
        base.whereIn('a.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
      } else {
        // Cannot enforce office scope without hospcode column; fail closed.
        base.whereRaw('1 = 0');
      }
    }

    if (input.search) {
      base.andWhere((builder) => {
        builder.where('a.cid', 'like', `%${input.search}%`);
        if (tableMeta.hasUsersTable && (tableMeta.hasUserFirstName || tableMeta.hasUserFname)) {
          builder.orWhereRaw(`${this.getFirstNameExpression(tableMeta)} LIKE ?`, [`%${input.search}%`]);
        }
        if (tableMeta.hasUsersTable && (tableMeta.hasUserLastName || tableMeta.hasUserLname)) {
          builder.orWhereRaw(`${this.getLastNameExpression(tableMeta)} LIKE ?`, [`%${input.search}%`]);
        }
      });
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rowsQuery = base
      .clone()
      .select(
        'a.id',
        'a.cid',
        'a.attendance_date',
        this.db.raw('a.check_in_time AS check_in_at'),
        this.db.raw('a.check_out_time AS check_out_at')
      );

    if (tableMeta.hasHospcode) {
      rowsQuery.select('a.hospcode');
    } else {
      rowsQuery.select(this.db.raw('NULL AS hospcode'));
    }

    if (tableMeta.hasUsersTable) {
      rowsQuery
        .select(this.db.raw(`${this.getFirstNameExpression(tableMeta)} AS first_name`))
        .select(this.db.raw(`${this.getLastNameExpression(tableMeta)} AS last_name`));
    } else {
      rowsQuery
        .select(this.db.raw('NULL AS first_name'))
        .select(this.db.raw('NULL AS last_name'));
    }

    const rows = await rowsQuery
      .orderBy('a.attendance_date', 'desc')
      .orderBy('a.check_in_time', 'desc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      rows,
      total: Number(total ?? 0)
    };
  }

  async listAttendanceRecordsForExport(input: AttendanceExportInput) {
    const tableMeta = await this.getAttendanceTableMeta();
    const query = this.db(`${config.mymophTables.attendanceLogs} as a`).whereBetween('a.attendance_date', [input.from, input.to]);

    if (tableMeta.hasUsersTable) {
      query.leftJoin('users as u', 'u.cid', 'a.cid');
    }

    if (input.scopeType === 'LIST') {
      if (tableMeta.hasHospcode) {
        query.whereIn('a.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
      } else {
        query.whereRaw('1 = 0');
      }
    }

    if (input.search) {
      query.andWhere((builder) => {
        builder.where('a.cid', 'like', `%${input.search}%`);
        if (tableMeta.hasUsersTable && (tableMeta.hasUserFirstName || tableMeta.hasUserFname)) {
          builder.orWhereRaw(`${this.getFirstNameExpression(tableMeta)} LIKE ?`, [`%${input.search}%`]);
        }
        if (tableMeta.hasUsersTable && (tableMeta.hasUserLastName || tableMeta.hasUserLname)) {
          builder.orWhereRaw(`${this.getLastNameExpression(tableMeta)} LIKE ?`, [`%${input.search}%`]);
        }
      });
    }

    query.select(
      'a.id',
      'a.cid',
      'a.attendance_date',
      this.db.raw('a.check_in_time AS check_in_at'),
      this.db.raw('a.check_out_time AS check_out_at')
    );

    if (tableMeta.hasHospcode) {
      query.select('a.hospcode');
    } else {
      query.select(this.db.raw('NULL AS hospcode'));
    }

    if (tableMeta.hasUsersTable) {
      query
        .select(this.db.raw(`${this.getFirstNameExpression(tableMeta)} AS first_name`))
        .select(this.db.raw(`${this.getLastNameExpression(tableMeta)} AS last_name`));
    } else {
      query
        .select(this.db.raw('NULL AS first_name'))
        .select(this.db.raw('NULL AS last_name'));
    }

    return query
      .orderBy('a.attendance_date', 'asc')
      .orderBy('a.check_in_time', 'asc');
  }

  async listPersonnelProfilesForExport(input: {
    scopeType: 'ALL' | 'LIST';
    hospcodes: string[];
  }) {
    const sourceDbs: Knex[] = [];
    if (this.systemDb) sourceDbs.push(this.systemDb);
    if (!sourceDbs.includes(this.db)) sourceDbs.push(this.db);

    const merged = new Map<string, any>();
    for (const sourceDb of sourceDbs) {
      const rows = await this.fetchPersonnelFromSource(sourceDb, input);
      for (const row of rows) {
        const cid = String(row.cid ?? '').trim();
        const hospcode = String(row.hospcode ?? '').trim();
        if (!cid || !hospcode) continue;
        merged.set(`${cid}|${hospcode}`, row);
      }
    }

    return [...merged.values()].sort((a, b) => {
      const hospA = String(a.hospcode ?? '');
      const hospB = String(b.hospcode ?? '');
      if (hospA !== hospB) return hospA.localeCompare(hospB);

      const cidA = String(a.cid ?? '');
      const cidB = String(b.cid ?? '');
      return cidA.localeCompare(cidB);
    });
  }

  private async fetchPersonnelFromSource(
    sourceDb: Knex,
    input: { scopeType: 'ALL' | 'LIST'; hospcodes: string[] }
  ) {
    const executeQuery = async (withIsActive: boolean) => {
      const query = sourceDb('personnel_profiles as p')
        .select('p.cid', 'p.first_name', 'p.last_name', 'p.hospcode');

      if (withIsActive) {
        query.where('p.is_active', 1);
      }

      if (input.scopeType === 'LIST') {
        query.whereIn('p.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
      } else if (input.hospcodes.length) {
        query.whereIn('p.hospcode', input.hospcodes);
      }

      return query;
    };

    try {
      return await executeQuery(true);
    } catch (error) {
      const code = (error as any)?.code;
      if (code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_TABLE_ERROR') {
        return [];
      }

      if (code === 'ER_BAD_FIELD_ERROR') {
        return executeQuery(false);
      }

      throw error;
    }
  }

  private async getAttendanceTableMeta(): Promise<AttendanceTableMeta> {
    if (!this.tableMetaPromise) {
      this.tableMetaPromise = this.loadAttendanceTableMeta();
    }

    return this.tableMetaPromise;
  }

  private async loadAttendanceTableMeta(): Promise<AttendanceTableMeta> {
    const attendanceRows = await this.db('information_schema.columns')
      .select('COLUMN_NAME as column_name')
      .whereRaw('TABLE_SCHEMA = DATABASE()')
      .andWhere('TABLE_NAME', config.mymophTables.attendanceLogs);

    const attendanceColumns = new Set<string>(attendanceRows.map((row) => row.column_name));

    const userRows = await this.db('information_schema.columns')
      .select('COLUMN_NAME as column_name')
      .whereRaw('TABLE_SCHEMA = DATABASE()')
      .andWhere('TABLE_NAME', 'users');
    const userColumns = new Set<string>(userRows.map((row) => row.column_name));

    return {
      hasHospcode: attendanceColumns.has('hospcode'),
      hasUsersTable: userRows.length > 0,
      hasUserFirstName: userColumns.has('first_name'),
      hasUserLastName: userColumns.has('last_name'),
      hasUserFname: userColumns.has('fname'),
      hasUserLname: userColumns.has('lname')
    };
  }

  private getFirstNameExpression(meta: AttendanceTableMeta): string {
    const sources: string[] = [];
    if (meta.hasUserFirstName) sources.push('u.first_name');
    if (meta.hasUserFname) sources.push('u.fname');
    return sources.length ? `COALESCE(${sources.join(', ')})` : 'NULL';
  }

  private getLastNameExpression(meta: AttendanceTableMeta): string {
    const sources: string[] = [];
    if (meta.hasUserLastName) sources.push('u.last_name');
    if (meta.hasUserLname) sources.push('u.lname');
    return sources.length ? `COALESCE(${sources.join(', ')})` : 'NULL';
  }
}
