import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

const TAX_YEARS_TABLE = 'tax_years';
const TAX_DOCUMENTS_TABLE = 'tax_documents';
const TAX_DOCUMENT_DELETE_LOGS_TABLE = 'tax_document_delete_logs';
import { HCODE_TABLE } from '../../shared/services/hcode-bridge.service';

export interface TaxYearRow {
  id: number;
  year_be: number;
  hospcode: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TaxDocumentRow {
  id: string;
  tax_year_id: number;
  hospcode: string;
  cid: string;
  file_no: number;
  file_name: string;
  original_file_name: string | null;
  relative_path: string;
  source_type: 'single' | 'batch';
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface ListYearsInput {
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
  hospcodeSearch?: string;
}

interface ListDocumentsInput {
  yearId: number;
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
  search?: string;
  pageSize: number;
  offset: number;
}

interface SearchDocumentsInput {
  /** คำค้นเทียบกับเลขบัตรและชื่อไฟล์ ว่างได้ถ้ากรองด้วยปีหรือหน่วยงานอย่างเดียว */
  search?: string;
  /** กรองปี พ.ศ. ไม่ระบุ = ทุกปี */
  yearBe?: number;
  /** กรองหน่วยงาน ต้องอยู่ในขอบเขตของบัญชีด้วย service ตรวจให้แล้ว */
  hospcode?: string;
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
  pageSize: number;
  offset: number;
}

interface ListYearlyPeopleOverviewInput {
  yearBe: number;
  search?: string;
  pageSize: number;
  offset: number;
  /** ALL เห็นทุกหน่วยงาน LIST เห็นเฉพาะที่ตัวเองดูแล */
  scopeType: 'ALL' | 'LIST';
  hospcodes: string[];
}

export interface CreateTaxYearInput {
  yearBe: number;
  hospcode: string;
  actorId?: string;
}

interface UpdateTaxYearInput {
  yearBe: number;
  actorId?: string;
}

export interface InsertTaxDocumentRow {
  taxYearId: number;
  yearBe: number;
  hospcode: string;
  cid: string;
  fileNo: number;
  fileName: string;
  originalFileName: string;
  relativePath: string;
  sourceType: 'single' | 'batch';
  createdBy?: string;
}

export interface UpdateTaxDocumentInput {
  yearBe: number;
  cid: string;
  fileNo: number;
  fileName: string;
  originalFileName: string;
  relativePath: string;
  updatedBy?: string;
}

export type TaxDocumentDeleteReason = 'document_delete' | 'year_delete';

export interface InsertTaxDocumentDeleteLogRow {
  documentId: string;
  taxYearId: number;
  yearBe: number;
  hospcode: string;
  cid: string;
  fileNo: number;
  fileName: string;
  originalFileName: string | null;
  relativePath: string;
  sourceType: 'single' | 'batch';
  deletedBy?: string;
  deleteReason: TaxDocumentDeleteReason;
}

export class TaxModel {
  constructor(private readonly db: Knex) {}

  /**
   * ตรวจว่ารหัสหน่วยงานมีอยู่จริงในทะเบียนกลาง hcode_health_office
   *
   * ย้ายมาจากตาราง organizations ที่เคยกรอกมือ 104 แถว
   * รับได้ทั้ง code5 และ hcode9 ตามหลักใน 11-HCODE-MIGRATION.md
   * และรับเฉพาะหน่วยงานที่ยังเปิดทำการ
   */
  /**
   * แปลงรหัสที่รับเข้ามา (code5 หรือ hcode9) ให้เป็นคู่รหัสตามทะเบียนกลาง
   *
   * เดิมชื่อ organizationExists และคืนแค่ true/false ผู้เรียกจึงเอาค่าที่รับมา
   * ไปเก็บลงฐานดิบ ๆ ทั้งที่อาจเป็น hcode9 ซึ่งกลายเป็นชื่อโฟลเดอร์บนดิสก์ด้วย
   *
   * เรียงแบบเดียวกับ HcodeBridgeService เพราะ code5 บางตัวชี้ไปหลาย hcode9
   */
  async resolveOfficeCode(hospcode: string): Promise<{ code5: string | null; hcode9: string } | null> {
    const code = String(hospcode ?? '').trim();
    if (!code) return null;

    const row = await this.db(HCODE_TABLE)
      .where((builder) => {
        builder.where('code5', code).orWhere('hcode9', code);
      })
      .andWhere('active', 1)
      .orderBy([{ column: 'modified_date', order: 'desc' }])
      .select('code5', 'hcode9')
      .first();

    if (!row) return null;

    const code5 = row.code5 ? String(row.code5).trim() : '';
    return { code5: code5 || null, hcode9: String(row.hcode9).trim() };
  }

  async listYears(input: ListYearsInput) {
    const countSubQuery = this.db(TAX_DOCUMENTS_TABLE)
      .select('tax_year_id')
      .count<{ tax_year_id: number; document_count: number }[]>({ document_count: '*' })
      .where('is_active', 1)
      .groupBy('tax_year_id')
      .as('dc');

    const query = this.db(`${TAX_YEARS_TABLE} as y`)
      .leftJoin(countSubQuery, 'dc.tax_year_id', 'y.id')
      .where('y.is_active', 1)
      .select(
        'y.id',
        'y.year_be',
        'y.hospcode',
        'y.created_at',
        'y.updated_at',
        this.db.raw('COALESCE(dc.document_count, 0) as document_count')
      )
      .orderBy('y.year_be', 'desc')
      .orderBy('y.hospcode', 'asc');

    if (input.scopeType === 'LIST') {
      query.whereIn('y.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.hospcodeSearch) {
      query.andWhere('y.hospcode', 'like', `%${input.hospcodeSearch}%`);
    }

    return query;
  }

  async createYear(input: CreateTaxYearInput) {
    const payload = {
      year_be: input.yearBe,
      hospcode: input.hospcode,
      is_active: 1,
      created_by: input.actorId ?? null,
      updated_by: input.actorId ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    };

    const inserted = await this.db(TAX_YEARS_TABLE).insert(payload);
    const insertedId = Array.isArray(inserted) ? Number(inserted[0]) : Number(inserted);

    return insertedId;
  }

  async findYearById(id: number): Promise<TaxYearRow | undefined> {
    return this.db(TAX_YEARS_TABLE).where({ id }).first();
  }

  async findYearByYearHospcode(yearBe: number, hospcode: string): Promise<TaxYearRow | undefined> {
    return this.db(TAX_YEARS_TABLE).where({ year_be: yearBe, hospcode }).first();
  }

  async reactivateYear(id: number, actorId?: string) {
    await this.db(TAX_YEARS_TABLE)
      .where({ id })
      .update({
        is_active: 1,
        updated_by: actorId ?? null,
        updated_at: this.db.fn.now()
      });
  }

  async updateYear(id: number, input: UpdateTaxYearInput) {
    await this.db(TAX_YEARS_TABLE)
      .where({ id })
      .update({
        year_be: input.yearBe,
        updated_by: input.actorId ?? null,
        updated_at: this.db.fn.now()
      });
  }

  async hardDeleteYearDocumentsAndDeactivateYear(id: number, actorId?: string) {
    return this.db.transaction(async (trx) => {
      const documents = await trx(TAX_DOCUMENTS_TABLE)
        .where({ tax_year_id: id, is_active: 1 })
        .select(
          'id',
          'tax_year_id',
          'year_be',
          'hospcode',
          'cid',
          'file_no',
          'file_name',
          'original_file_name',
          'relative_path',
          'source_type'
        );

      if (documents.length) {
        const logRows: InsertTaxDocumentDeleteLogRow[] = documents.map((doc: any) => ({
          documentId: String(doc.id),
          taxYearId: Number(doc.tax_year_id),
          yearBe: Number(doc.year_be),
          hospcode: String(doc.hospcode),
          cid: String(doc.cid),
          fileNo: Number(doc.file_no),
          fileName: String(doc.file_name),
          originalFileName: doc.original_file_name ? String(doc.original_file_name) : null,
          relativePath: String(doc.relative_path),
          sourceType: String(doc.source_type) === 'batch' ? 'batch' : 'single',
          deletedBy: actorId,
          deleteReason: 'year_delete'
        }));

        await trx(TAX_DOCUMENT_DELETE_LOGS_TABLE).insert(
          logRows.map((row) => ({
            document_id: row.documentId,
            tax_year_id: row.taxYearId,
            year_be: row.yearBe,
            hospcode: row.hospcode,
            cid: row.cid,
            file_no: row.fileNo,
            file_name: row.fileName,
            original_file_name: row.originalFileName,
            relative_path: row.relativePath,
            source_type: row.sourceType,
            deleted_by: row.deletedBy ?? null,
            delete_reason: row.deleteReason,
            deleted_at: trx.fn.now()
          }))
        );

        await trx(TAX_DOCUMENTS_TABLE)
          .where({ tax_year_id: id, is_active: 1 })
          .delete();
      }

      await trx(TAX_YEARS_TABLE)
        .where({ id })
        .andWhere('is_active', 1)
        .update({
          is_active: 0,
          updated_by: actorId ?? null,
          updated_at: trx.fn.now()
        });

      return documents.map((doc: any) => String(doc.relative_path || ''));
    });
  }

  async listDocuments(input: ListDocumentsInput) {
    const base = this.db(`${TAX_DOCUMENTS_TABLE} as d`)
      .innerJoin(`${TAX_YEARS_TABLE} as y`, 'y.id', 'd.tax_year_id')
      .where('d.is_active', 1)
      .andWhere('y.is_active', 1)
      .andWhere('d.tax_year_id', input.yearId);

    if (input.scopeType === 'LIST') {
      base.whereIn('d.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.search) {
      base.andWhere((qb) => {
        qb.where('d.cid', 'like', `%${input.search}%`).orWhere('d.file_name', 'like', `%${input.search}%`);
      });
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select(
        'd.id',
        'd.tax_year_id',
        'd.hospcode',
        'd.cid',
        'd.file_no',
        'd.file_name',
        'd.original_file_name',
        'd.source_type',
        'd.created_at',
        'd.updated_at'
      )
      .orderBy('d.cid', 'asc')
      .orderBy('d.file_no', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      total: Number(total ?? 0),
      rows
    };
  }

  /**
   * ค้นไฟล์ข้ามปีและข้ามหน่วยงาน ภายใต้ขอบเขตของบัญชี
   *
   * ต่างจาก listDocuments ที่ล็อกอยู่ปีเดียว เส้นนี้ใช้ตอนรู้เลขบัตรแต่ไม่รู้ว่า
   * อยู่ปีไหนหน่วยงานไหน จึงต้องคืนปีกับหน่วยงานมาในแถวด้วย
   *
   * เลขบัตรครบ 13 หลักใช้ `=` เพื่อให้ไปทาง idx_tax_doc_cid
   * ส่วนคำค้นบางส่วนต้องใช้ LIKE ที่มี % นำหน้า ซึ่งใช้ index ไม่ได้
   * ตอนนี้ตารางมี 135k แถวและวัดได้ 13-26 ms จึงยังรับได้
   * ถ้าข้อมูลโตเป็นหลายปีควรทบทวนจุดนี้
   */
  async searchDocuments(input: SearchDocumentsInput) {
    const base = this.db(`${TAX_DOCUMENTS_TABLE} as d`)
      .innerJoin(`${TAX_YEARS_TABLE} as y`, 'y.id', 'd.tax_year_id')
      .where('d.is_active', 1)
      .andWhere('y.is_active', 1);

    if (input.scopeType === 'LIST') {
      base.whereIn('d.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.hospcode) {
      base.andWhere('d.hospcode', input.hospcode);
    }

    /*
     * กรองด้วยปีของ "แถวปีภาษี" ไม่ใช่ปีที่ denormalize ไว้ในเอกสาร
     *
     * ตัวเลือกปีในหน้าเว็บมาจาก tax_years ถ้ากรองด้วย d.year_be ผลจะขัดกับ
     * ตารางปีที่อยู่หน้าเดียวกัน เพราะมีข้อมูลที่สองค่านี้ไม่ตรงกันอยู่จริง
     * (ปี id=14 เป็น 2568 แต่เอกสาร 1,228 แถวของมันบันทึก 2500 ไว้
     *  ร่องรอยของการแก้ปีภาษีย้อนหลังสมัยที่ยังทำได้)
     */
    if (input.yearBe !== undefined) {
      base.andWhere('y.year_be', input.yearBe);
    }

    if (input.search) {
      const term = input.search;
      if (/^\d{13}$/.test(term)) {
        base.andWhere('d.cid', term);
      } else {
        base.andWhere((qb) => {
          qb.where('d.cid', 'like', `%${term}%`).orWhere('d.file_name', 'like', `%${term}%`);
        });
      }
    }

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });

    const rows = await base
      .clone()
      .select(
        'd.id',
        'd.tax_year_id',
        // ปีที่เชื่อถือได้คือของแถวปีภาษี ซึ่งเป็นตัวที่หน้าเว็บใช้นำทางและนับจำนวนไฟล์
        { year_be: 'y.year_be' },
        // ปีที่เอกสารบันทึกไว้เอง เก็บมาด้วยเพื่อให้เห็นได้เมื่อสองค่าไม่ตรงกัน
        { document_year_be: 'd.year_be' },
        'd.hospcode',
        'd.cid',
        'd.file_no',
        'd.file_name',
        'd.original_file_name',
        'd.source_type',
        'd.created_at',
        'd.updated_at'
      )
      .orderBy('y.year_be', 'desc')
      .orderBy('d.hospcode', 'asc')
      .orderBy('d.cid', 'asc')
      .orderBy('d.file_no', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      total: Number(total ?? 0),
      rows
    };
  }

  async listYearlyPeopleOverview(input: ListYearlyPeopleOverviewInput) {
    const base = this.db(`${TAX_DOCUMENTS_TABLE} as d`)
      .where('d.is_active', 1)
      .andWhere('d.year_be', input.yearBe);

    // TAX-03: เดิมกรองด้วยปีอย่างเดียว ผู้ที่มีบทบาท super_admin_affairs
    // ซึ่งมีขอบเขตหน่วยงานเดียว จึงเห็นข้อมูลของทุกหน่วยงานในปีนั้น
    if (input.scopeType === 'LIST') {
      base.whereIn('d.hospcode', input.hospcodes.length ? input.hospcodes : ['']);
    }

    if (input.search) {
      base.andWhere((qb) => {
        qb.where('d.cid', 'like', `%${input.search}%`)
          .orWhere('d.hospcode', 'like', `%${input.search}%`)
          .orWhere('d.file_name', 'like', `%${input.search}%`);
      });
    }

    const totalResult = await base
      .clone()
      .countDistinct<{ total: number }[]>({ total: 'd.cid' });
    const total = Number(totalResult?.[0]?.total ?? 0);

    const rows = await base
      .clone()
      .select(
        'd.cid',
        this.db.raw('COUNT(*) as total_files'),
        this.db.raw('COUNT(DISTINCT d.hospcode) as hospcode_count'),
        this.db.raw("GROUP_CONCAT(DISTINCT d.hospcode ORDER BY d.hospcode SEPARATOR ', ') as hospcodes"),
        this.db.raw('MAX(d.updated_at) as updated_at')
      )
      .groupBy('d.cid')
      .orderByRaw('COUNT(*) DESC')
      .orderBy('d.cid', 'asc')
      .limit(input.pageSize)
      .offset(input.offset);

    return {
      total,
      rows
    };
  }

  async findDocumentById(id: string): Promise<TaxDocumentRow | undefined> {
    return this.db(TAX_DOCUMENTS_TABLE).where({ id }).first();
  }

  async findDocumentByIdWithYear(id: string) {
    return this.db(`${TAX_DOCUMENTS_TABLE} as d`)
      .innerJoin(`${TAX_YEARS_TABLE} as y`, 'y.id', 'd.tax_year_id')
      .where('d.id', id)
      .select(
        'd.id',
        'd.tax_year_id',
        'd.hospcode',
        'd.cid',
        'd.file_no',
        'd.file_name',
        'd.original_file_name',
        'd.relative_path',
        'd.source_type',
        'd.is_active',
        'd.created_at',
        'd.updated_at',
        'y.year_be',
        'y.is_active as year_active'
      )
      .first();
  }

  async getMaxFileNoByYearBeAndCids(yearBe: number, cids: string[]) {
    if (!cids.length) return new Map<string, number>();

    const rows = await this.db(TAX_DOCUMENTS_TABLE)
      .where({ year_be: yearBe })
      .andWhere('is_active', 1)
      .whereIn('cid', cids)
      .select('cid')
      .max<{ cid: string; max_file_no: number }[]>({ max_file_no: 'file_no' })
      .groupBy('cid');

    const map = new Map<string, number>();
    rows.forEach((row: any) => {
      map.set(String(row.cid), Number(row.max_file_no ?? 0));
    });

    return map;
  }

  async insertDocuments(rows: InsertTaxDocumentRow[]) {
    if (!rows.length) return [] as string[];

    const payload = rows.map((row) => ({
      id: uuidv4(),
      tax_year_id: row.taxYearId,
      year_be: row.yearBe,
      hospcode: row.hospcode,
      cid: row.cid,
      file_no: row.fileNo,
      file_name: row.fileName,
      original_file_name: row.originalFileName,
      relative_path: row.relativePath,
      source_type: row.sourceType,
      is_active: 1,
      created_by: row.createdBy ?? null,
      updated_by: row.createdBy ?? null,
      created_at: this.db.fn.now(),
      updated_at: this.db.fn.now()
    }));

    await this.db(TAX_DOCUMENTS_TABLE).insert(payload);
    return payload.map((row) => row.id);
  }

  async updateDocument(id: string, input: UpdateTaxDocumentInput) {
    await this.db(TAX_DOCUMENTS_TABLE)
      .where({ id })
      .update({
        cid: input.cid,
        year_be: input.yearBe,
        file_no: input.fileNo,
        file_name: input.fileName,
        original_file_name: input.originalFileName,
        relative_path: input.relativePath,
        updated_by: input.updatedBy ?? null,
        updated_at: this.db.fn.now()
      });
  }

  async hardDeleteDocumentWithLog(input: InsertTaxDocumentDeleteLogRow) {
    await this.db.transaction(async (trx) => {
      await trx(TAX_DOCUMENT_DELETE_LOGS_TABLE).insert({
        document_id: input.documentId,
        tax_year_id: input.taxYearId,
        year_be: input.yearBe,
        hospcode: input.hospcode,
        cid: input.cid,
        file_no: input.fileNo,
        file_name: input.fileName,
        original_file_name: input.originalFileName,
        relative_path: input.relativePath,
        source_type: input.sourceType,
        deleted_by: input.deletedBy ?? null,
        delete_reason: input.deleteReason,
        deleted_at: trx.fn.now()
      });

      await trx(TAX_DOCUMENTS_TABLE).where({ id: input.documentId, is_active: 1 }).delete();
    });
  }
}
