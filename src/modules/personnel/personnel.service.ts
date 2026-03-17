import { StatusCodes } from 'http-status-codes';
import ExcelJS from 'exceljs';
import type { AuthContext } from '../../shared/types/auth';
import { PersonnelModel, type PersonnelUpsertRow } from './personnel.model';

interface ListQuery {
  search?: string;
  page: number;
  pageSize: number;
  offset: number;
}

interface UpsertPersonnelInput {
  cid: string;
  firstName: string;
  lastName: string;
  hospcode: string;
}

interface ParsedExcelRow {
  rowNumber: number;
  cid: string;
  firstName: string;
  lastName: string;
  hospcode?: string;
}

const CID_REGEX = /^\d{13}$/;

export class PersonnelService {
  constructor(private readonly model: PersonnelModel) {}

  async list(auth: AuthContext, query: ListQuery) {
    const data = await this.model.list({
      search: query.search,
      scopeType: auth.scopeType,
      hospcodes: auth.hospcodes,
      pageSize: query.pageSize,
      offset: query.offset
    });

    return {
      ...data,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async create(auth: AuthContext, input: UpsertPersonnelInput) {
    const normalized = this.normalizeInput(input);
    if (!normalized.ok) return normalized;

    const validation = this.validateScope(auth, normalized.hospcode);
    if (!validation.ok) return validation;

    const existing = await this.model.findByCidHospcode(normalized.cid, normalized.hospcode);
    if (existing) {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'PERSONNEL_ALREADY_EXISTS' };
    }

    const id = await this.model.create({
      cid: normalized.cid,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      hospcode: normalized.hospcode,
      createdBy: auth.userId
    });

    return { ok: true, status: StatusCodes.CREATED, data: { id } };
  }

  async update(auth: AuthContext, id: string, input: Partial<UpsertPersonnelInput>) {
    const existing = await this.model.findById(id);
    if (!existing || Number(existing.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'PERSONNEL_NOT_FOUND' };
    }

    const canAccessCurrent = this.validateScope(auth, String(existing.hospcode));
    if (!canAccessCurrent.ok) return canAccessCurrent;

    const merged: UpsertPersonnelInput = {
      cid: String(input.cid ?? existing.cid ?? '').trim(),
      firstName: String(input.firstName ?? existing.first_name ?? '').trim(),
      lastName: String(input.lastName ?? existing.last_name ?? '').trim(),
      hospcode: String(input.hospcode ?? existing.hospcode ?? '').trim()
    };

    const normalized = this.normalizeInput(merged);
    if (!normalized.ok) return normalized;

    const targetScope = this.validateScope(auth, normalized.hospcode);
    if (!targetScope.ok) return targetScope;

    const duplicate = await this.model.findByCidHospcode(normalized.cid, normalized.hospcode);
    if (duplicate && String(duplicate.id) !== id) {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'PERSONNEL_ALREADY_EXISTS' };
    }

    await this.model.updateById(id, {
      cid: normalized.cid,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      hospcode: normalized.hospcode,
      updatedBy: auth.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async remove(auth: AuthContext, id: string) {
    const existing = await this.model.findById(id);
    if (!existing || Number(existing.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'PERSONNEL_NOT_FOUND' };
    }

    const validation = this.validateScope(auth, String(existing.hospcode));
    if (!validation.ok) return validation;

    await this.model.softDeleteById(id, auth.userId);
    return { ok: true, status: StatusCodes.OK };
  }

  async exportTemplate(): Promise<{ filename: string; fileBuffer: Buffer }> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('personnel-template');

    sheet.columns = [
      { header: 'CID', key: 'cid', width: 18 },
      { header: 'FIRST_NAME', key: 'first_name', width: 24 },
      { header: 'LAST_NAME', key: 'last_name', width: 24 },
      { header: 'HOSPCODE', key: 'hospcode', width: 14 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      cid: '1234567890123',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      hospcode: '41124'
    });

    sheet.addRow({
      cid: '',
      first_name: '',
      last_name: '',
      hospcode: ''
    });

    // sheet.getCell('A4').value =
    //   'หมายเหตุ: หากผู้ใช้มี scope เดียว สามารถเว้น HOSPCODE ได้ ระบบจะเติมให้อัตโนมัติ';
    // sheet.mergeCells('A4:D4');

    const output = await workbook.xlsx.writeBuffer();
    const fileBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);

    return {
      filename: 'personnel-template.xlsx',
      fileBuffer
    };
  }

  async uploadExcel(auth: AuthContext, fileBuffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'EMPTY_EXCEL_FILE'
      };
    }

    const headerMap = this.resolveHeaderMap(worksheet.getRow(1));
    if (!headerMap.cid || !headerMap.firstName || !headerMap.lastName) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INVALID_TEMPLATE_HEADER'
      };
    }

    const parsedRows: ParsedExcelRow[] = [];
    const rowErrors: Array<{ rowNumber: number; error: string }> = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (!row.hasValues) continue;

      const cid = this.cellToString(row.getCell(headerMap.cid)).replace(/\s+/g, '');
      const firstName = this.cellToString(row.getCell(headerMap.firstName)).trim();
      const lastName = this.cellToString(row.getCell(headerMap.lastName)).trim();
      const hospcode = headerMap.hospcode ? this.cellToString(row.getCell(headerMap.hospcode)).trim() : '';

      if (!cid && !firstName && !lastName && !hospcode) {
        continue;
      }

      if (!CID_REGEX.test(cid)) {
        rowErrors.push({ rowNumber, error: 'INVALID_CID' });
        continue;
      }

      if (!firstName || !lastName) {
        rowErrors.push({ rowNumber, error: 'MISSING_NAME' });
        continue;
      }

      parsedRows.push({
        rowNumber,
        cid,
        firstName,
        lastName,
        hospcode: hospcode || undefined
      });
    }

    if (!parsedRows.length && !rowErrors.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'NO_DATA_IN_EXCEL'
      };
    }

    const uniqueMap = new Map<string, PersonnelUpsertRow>();
    const normalizedErrors = [...rowErrors];

    for (const row of parsedRows) {
      const resolvedHospcode = this.resolveHospcodeForRow(auth, row.hospcode);
      if (!resolvedHospcode.ok) {
        normalizedErrors.push({ rowNumber: row.rowNumber, error: resolvedHospcode.error });
        continue;
      }

      const scopeValidation = this.validateScope(auth, resolvedHospcode.hospcode);
      if (!scopeValidation.ok) {
        normalizedErrors.push({ rowNumber: row.rowNumber, error: 'SCOPE_FORBIDDEN' });
        continue;
      }

      const key = `${row.cid}|${resolvedHospcode.hospcode}`;
      uniqueMap.set(key, {
        cid: row.cid,
        firstName: row.firstName,
        lastName: row.lastName,
        hospcode: resolvedHospcode.hospcode
      });
    }

    const rows = [...uniqueMap.values()];
    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of rows) {
      const exists = await this.model.findByCidHospcode(row.cid, row.hospcode);
      if (exists) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
      }
    }

    if (rows.length) {
      await this.model.bulkUpsert(rows, auth.userId);
    }

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        processedCount: rows.length,
        insertedCount,
        updatedCount,
        errorCount: normalizedErrors.length,
        errors: normalizedErrors.slice(0, 50)
      }
    };
  }

  private normalizeInput(input: UpsertPersonnelInput):
    | { ok: true; cid: string; firstName: string; lastName: string; hospcode: string }
    | { ok: false; status: number; error: string } {
    const cid = String(input.cid ?? '').trim();
    const firstName = String(input.firstName ?? '').trim();
    const lastName = String(input.lastName ?? '').trim();
    const hospcode = String(input.hospcode ?? '').trim();

    if (!CID_REGEX.test(cid)) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_CID' };
    }

    if (!firstName || !lastName) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_NAME' };
    }

    if (!hospcode) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_HOSPCODE' };
    }

    return {
      ok: true,
      cid,
      firstName,
      lastName,
      hospcode
    };
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

  private resolveHospcodeForRow(auth: AuthContext, rawHospcode?: string):
    | { ok: true; hospcode: string }
    | { ok: false; error: string } {
    const hospcode = String(rawHospcode ?? '').trim();
    if (hospcode) {
      return { ok: true, hospcode };
    }

    if (auth.scopeType === 'LIST' && auth.hospcodes.length === 1) {
      return { ok: true, hospcode: auth.hospcodes[0] };
    }

    return { ok: false, error: 'MISSING_HOSPCODE' };
  }

  private resolveHeaderMap(row: ExcelJS.Row): {
    cid?: number;
    firstName?: number;
    lastName?: number;
    hospcode?: number;
  } {
    const map: { cid?: number; firstName?: number; lastName?: number; hospcode?: number } = {};

    row.eachCell((cell, colNumber) => {
      const value = this.cellToString(cell).trim().toLowerCase();
      if (!value) return;

      if (['cid', 'เลขบัตร', 'เลขบัตรประชาชน'].includes(value)) {
        map.cid = map.cid ?? colNumber;
      } else if (['first_name', 'firstname', 'first name', 'ชื่อ'].includes(value)) {
        map.firstName = map.firstName ?? colNumber;
      } else if (['last_name', 'lastname', 'last name', 'นามสกุล'].includes(value)) {
        map.lastName = map.lastName ?? colNumber;
      } else if (['hospcode', 'รหัสหน่วยงาน', 'หน่วยงาน'].includes(value)) {
        map.hospcode = map.hospcode ?? colNumber;
      }
    });

    return map;
  }

  private cellToString(cell: ExcelJS.Cell): string {
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';

    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (typeof value === 'object') {
      if ('text' in value && typeof (value as any).text === 'string') {
        return (value as any).text;
      }

      if ('result' in value && typeof (value as any).result !== 'undefined') {
        return String((value as any).result ?? '');
      }
    }

    return String(value);
  }
}
