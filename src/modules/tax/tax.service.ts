import path from 'path';
import { promises as fs } from 'fs';
import { StatusCodes } from 'http-status-codes';
import { PDFDocument } from 'pdf-lib';
import type { AuthContext } from '../../shared/types/auth';
import { TaxModel, type InsertTaxDocumentRow } from './tax.model';

interface PaginationQuery {
  search?: string;
  page: number;
  pageSize: number;
  offset: number;
}

interface YearInput {
  yearBe: number;
  hospcode?: string;
}

interface IndividualUploadItem {
  cid: string;
  originalName: string;
  buffer: Buffer;
}

interface UploadPlanItem {
  cid: string;
  fileNo: number;
  fileName: string;
  relativePath: string;
}

interface AccessibleYearInfo {
  yearId: number;
  yearBe: number;
  yearShort: string;
  hospcode: string;
}

interface UpdateDocumentInput {
  cid?: string;
  file?: {
    originalName: string;
    buffer: Buffer;
  };
}

const CID_REGEX = /^\d{13}$/;
const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'tax');

export class TaxService {
  constructor(private readonly model: TaxModel) {}

  async listYears(auth: AuthContext) {
    const rows = await this.model.listYears({
      scopeType: auth.scopeType,
      hospcodes: auth.hospcodes
    });

    return rows.map((row: any) => ({
      id: Number(row.id),
      yearBe: Number(row.year_be),
      yearShort: this.toYearShort(Number(row.year_be)),
      hospcode: String(row.hospcode),
      documentCount: Number(row.document_count ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async createYear(auth: AuthContext, input: YearInput) {
    const normalizedYear = this.normalizeYearBe(input.yearBe);
    if (!normalizedYear.ok) return normalizedYear;

    const hospcodeResult = this.resolveHospcodeForCreate(auth, input.hospcode);
    if (!hospcodeResult.ok) return hospcodeResult;

    const orgExists = await this.model.organizationExists(hospcodeResult.hospcode);
    if (!orgExists) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'HOSPCODE_NOT_FOUND' };
    }

    const exists = await this.model.findYearByYearHospcode(normalizedYear.yearBe, hospcodeResult.hospcode);
    if (exists && Number(exists.is_active) === 1) {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'TAX_YEAR_ALREADY_EXISTS' };
    }

    if (exists && Number(exists.is_active) !== 1) {
      await this.model.reactivateYear(Number(exists.id), auth.userId);
      return {
        ok: true,
        status: StatusCodes.CREATED,
        data: {
          id: Number(exists.id),
          yearBe: normalizedYear.yearBe,
          yearShort: this.toYearShort(normalizedYear.yearBe),
          hospcode: hospcodeResult.hospcode
        }
      };
    }

    const id = await this.model.createYear({
      yearBe: normalizedYear.yearBe,
      hospcode: hospcodeResult.hospcode,
      actorId: auth.userId
    });

    return {
      ok: true,
      status: StatusCodes.CREATED,
      data: {
        id,
        yearBe: normalizedYear.yearBe,
        yearShort: this.toYearShort(normalizedYear.yearBe),
        hospcode: hospcodeResult.hospcode
      }
    };
  }

  async updateYear(auth: AuthContext, yearId: number, input: YearInput) {
    const normalizedYear = this.normalizeYearBe(input.yearBe);
    if (!normalizedYear.ok) return normalizedYear;

    const year = await this.model.findYearById(yearId);
    if (!year || Number(year.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_YEAR_NOT_FOUND' };
    }

    const scopeValidation = this.validateScope(auth, String(year.hospcode));
    if (!scopeValidation.ok) return scopeValidation;

    const duplicate = await this.model.findYearByYearHospcode(normalizedYear.yearBe, String(year.hospcode));
    if (duplicate && Number(duplicate.id) !== Number(yearId)) {
      return { ok: false, status: StatusCodes.CONFLICT, error: 'TAX_YEAR_ALREADY_EXISTS' };
    }

    await this.model.updateYear(yearId, {
      yearBe: normalizedYear.yearBe,
      actorId: auth.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async deleteYear(auth: AuthContext, yearId: number) {
    const year = await this.model.findYearById(yearId);
    if (!year || Number(year.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_YEAR_NOT_FOUND' };
    }

    const scopeValidation = this.validateScope(auth, String(year.hospcode));
    if (!scopeValidation.ok) return scopeValidation;

    const documentPaths = await this.model.listDocumentPathsByYearId(yearId);
    await this.model.softDeleteYearAndDocuments(yearId, auth.userId);

    await Promise.all(
      documentPaths.map(async (row: any) => {
        const relativePath = String(row.relative_path || '');
        if (!relativePath) return;

        const filePath = this.resolveStoragePath(relativePath);
        await this.removeFileIfExists(filePath);
      })
    );

    return { ok: true, status: StatusCodes.OK };
  }

  async listDocuments(auth: AuthContext, yearId: number, query: PaginationQuery) {
    const year = await this.model.findYearById(yearId);
    if (!year || Number(year.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_YEAR_NOT_FOUND' };
    }

    const scopeValidation = this.validateScope(auth, String(year.hospcode));
    if (!scopeValidation.ok) return scopeValidation;

    const data = await this.model.listDocuments({
      yearId,
      scopeType: auth.scopeType,
      hospcodes: auth.hospcodes,
      search: query.search,
      pageSize: query.pageSize,
      offset: query.offset
    });

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        year: {
          id: Number(year.id),
          yearBe: Number(year.year_be),
          yearShort: this.toYearShort(Number(year.year_be)),
          hospcode: String(year.hospcode)
        },
        total: data.total,
        page: query.page,
        pageSize: query.pageSize,
        rows: data.rows
      }
    };
  }

  async uploadIndividual(auth: AuthContext, yearId: number, items: IndividualUploadItem[]) {
    const yearAccess = await this.getAccessibleYear(auth, yearId);
    if (!yearAccess.ok) return yearAccess;

    if (!items.length) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'EMPTY_UPLOAD_ITEMS' };
    }

    const invalidCid = items.find((item) => !CID_REGEX.test(String(item.cid).trim()));
    if (invalidCid) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_CID' };
    }

    const singlePageValidation = await this.validateIndividualPdfPages(items);
    if (!singlePageValidation.ok) return singlePageValidation;

    const plan = await this.buildUploadPlan({
      year: yearAccess,
      cids: items.map((item) => item.cid.trim())
    });

    const documentRows: InsertTaxDocumentRow[] = [];
    const writtenPaths: string[] = [];

    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const planItem = plan[index];
        const absolutePath = this.resolveStoragePath(planItem.relativePath);

        await this.writeBufferToStorage(absolutePath, item.buffer);
        writtenPaths.push(absolutePath);

        documentRows.push({
          taxYearId: yearId,
          yearBe: yearAccess.yearBe,
          hospcode: yearAccess.hospcode,
          cid: planItem.cid,
          fileNo: planItem.fileNo,
          fileName: planItem.fileName,
          originalFileName: item.originalName,
          relativePath: planItem.relativePath,
          sourceType: 'single',
          createdBy: auth.userId
        });
      }

      await this.model.insertDocuments(documentRows);

      return {
        ok: true,
        status: StatusCodes.CREATED,
        data: {
          createdCount: documentRows.length
        }
      };
    } catch (error) {
      await Promise.all(writtenPaths.map((filePath) => this.removeFileIfExists(filePath)));
      throw error;
    }
  }

  async previewIndividualUpload(auth: AuthContext, yearId: number, items: IndividualUploadItem[]) {
    const yearAccess = await this.getAccessibleYear(auth, yearId);
    if (!yearAccess.ok) return yearAccess;

    if (!items.length) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'EMPTY_UPLOAD_ITEMS' };
    }

    const invalidCid = items.find((item) => !CID_REGEX.test(String(item.cid).trim()));
    if (invalidCid) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_CID' };
    }

    const singlePageValidation = await this.validateIndividualPdfPages(items);
    if (!singlePageValidation.ok) return singlePageValidation;

    const plan = await this.buildUploadPlan({
      year: yearAccess,
      cids: items.map((item) => item.cid.trim())
    });

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        yearId: yearAccess.yearId,
        yearBe: yearAccess.yearBe,
        yearShort: yearAccess.yearShort,
        hospcode: yearAccess.hospcode,
        rows: plan.map((item, index) => ({
          cid: item.cid,
          fileNo: item.fileNo,
          fileName: item.fileName,
          originalFileName: items[index].originalName,
          pageCount: 1
        }))
      }
    };
  }

  async uploadBatch(auth: AuthContext, yearId: number, sourcePdfBuffer: Buffer, mappingTxtBuffer: Buffer) {
    const yearAccess = await this.getAccessibleYear(auth, yearId);
    if (!yearAccess.ok) return yearAccess;

    const batchPreparation = await this.prepareBatchUpload(yearAccess, sourcePdfBuffer, mappingTxtBuffer);
    if (!batchPreparation.ok) return batchPreparation;

    const documentRows: InsertTaxDocumentRow[] = [];
    const writtenPaths: string[] = [];

    try {
      for (let index = 0; index < batchPreparation.plan.length; index += 1) {
        const planItem = batchPreparation.plan[index];

        const pagePdf = await PDFDocument.create();
        const [copiedPage] = await pagePdf.copyPages(batchPreparation.sourcePdf, [index]);
        pagePdf.addPage(copiedPage);
        const pageBytes = await pagePdf.save();

        const absolutePath = this.resolveStoragePath(planItem.relativePath);

        await this.writeBufferToStorage(absolutePath, Buffer.from(pageBytes));
        writtenPaths.push(absolutePath);

        documentRows.push({
          taxYearId: yearId,
          yearBe: yearAccess.yearBe,
          hospcode: yearAccess.hospcode,
          cid: planItem.cid,
          fileNo: planItem.fileNo,
          fileName: planItem.fileName,
          originalFileName: 'batch-split',
          relativePath: planItem.relativePath,
          sourceType: 'batch',
          createdBy: auth.userId
        });
      }

      await this.model.insertDocuments(documentRows);

      return {
        ok: true,
        status: StatusCodes.CREATED,
        data: {
          createdCount: documentRows.length,
          pageCount: batchPreparation.pageCount,
          lineCount: batchPreparation.lineCount,
          delimiter: batchPreparation.delimiter
        }
      };
    } catch (error) {
      await Promise.all(writtenPaths.map((filePath) => this.removeFileIfExists(filePath)));
      throw error;
    }
  }

  async previewBatchUpload(auth: AuthContext, yearId: number, sourcePdfBuffer: Buffer, mappingTxtBuffer: Buffer) {
    const yearAccess = await this.getAccessibleYear(auth, yearId);
    if (!yearAccess.ok) return yearAccess;

    const batchPreparation = await this.prepareBatchUpload(yearAccess, sourcePdfBuffer, mappingTxtBuffer);
    if (!batchPreparation.ok) return batchPreparation;

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        yearId: yearAccess.yearId,
        yearBe: yearAccess.yearBe,
        yearShort: yearAccess.yearShort,
        hospcode: yearAccess.hospcode,
        pageCount: batchPreparation.pageCount,
        lineCount: batchPreparation.lineCount,
        delimiter: batchPreparation.delimiter,
        rows: batchPreparation.plan.map((item, index) => ({
          pageNo: index + 1,
          cid: item.cid,
          fileNo: item.fileNo,
          fileName: item.fileName
        }))
      }
    };
  }

  async updateDocument(auth: AuthContext, documentId: string, input: UpdateDocumentInput) {
    const doc = await this.model.findDocumentByIdWithYear(documentId);
    if (!doc || Number(doc.is_active) !== 1 || Number(doc.year_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_DOCUMENT_NOT_FOUND' };
    }

    const hospcode = String(doc.hospcode);
    const scopeValidation = this.validateScope(auth, hospcode);
    if (!scopeValidation.ok) return scopeValidation;

    const nextCid = String(input.cid ?? doc.cid).trim();
    if (!CID_REGEX.test(nextCid)) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_CID' };
    }

    const yearShort = this.toYearShort(Number(doc.year_be));
    let nextFileNo = Number(doc.file_no);

    if (nextCid !== String(doc.cid)) {
      const maxMap = await this.model.getMaxFileNoByYearBeAndCids(Number(doc.year_be), [nextCid]);
      nextFileNo = (maxMap.get(nextCid) ?? 0) + 1;
    }

    const nextFileName = this.buildFileName(yearShort, nextCid, nextFileNo);
    const nextRelativePath = this.buildRelativePath(yearShort, hospcode, nextFileName);
    const nextAbsolutePath = this.resolveStoragePath(nextRelativePath);

    const currentAbsolutePath = this.resolveStoragePath(String(doc.relative_path));

    let sourceBuffer: Buffer;
    if (input.file?.buffer) {
      sourceBuffer = input.file.buffer;
    } else {
      try {
        sourceBuffer = await fs.readFile(currentAbsolutePath);
      } catch (_error) {
        return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'SOURCE_FILE_NOT_FOUND' };
      }
    }

    await this.writeBufferToStorage(nextAbsolutePath, sourceBuffer);

    if (currentAbsolutePath !== nextAbsolutePath) {
      await this.removeFileIfExists(currentAbsolutePath);
    }

    await this.model.updateDocument(documentId, {
      yearBe: Number(doc.year_be),
      cid: nextCid,
      fileNo: nextFileNo,
      fileName: nextFileName,
      originalFileName: input.file?.originalName ?? String(doc.original_file_name ?? doc.file_name),
      relativePath: nextRelativePath,
      updatedBy: auth.userId
    });

    return { ok: true, status: StatusCodes.OK };
  }

  async deleteDocument(auth: AuthContext, documentId: string) {
    const doc = await this.model.findDocumentByIdWithYear(documentId);
    if (!doc || Number(doc.is_active) !== 1 || Number(doc.year_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_DOCUMENT_NOT_FOUND' };
    }

    const hospcode = String(doc.hospcode);
    const scopeValidation = this.validateScope(auth, hospcode);
    if (!scopeValidation.ok) return scopeValidation;

    await this.model.softDeleteDocument(documentId, auth.userId);

    const absolutePath = this.resolveStoragePath(String(doc.relative_path));
    await this.removeFileIfExists(absolutePath);

    return { ok: true, status: StatusCodes.OK };
  }

  async getDownloadPayload(auth: AuthContext, documentId: string) {
    const doc = await this.model.findDocumentByIdWithYear(documentId);
    if (!doc || Number(doc.is_active) !== 1 || Number(doc.year_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_DOCUMENT_NOT_FOUND' };
    }

    const scopeValidation = this.validateScope(auth, String(doc.hospcode));
    if (!scopeValidation.ok) return scopeValidation;

    const absolutePath = this.resolveStoragePath(String(doc.relative_path));
    try {
      await fs.access(absolutePath);
    } catch (_error) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'FILE_NOT_FOUND' };
    }

    return {
      ok: true,
      status: StatusCodes.OK,
      data: {
        absolutePath,
        fileName: String(doc.file_name)
      }
    };
  }

  private async getAccessibleYear(auth: AuthContext, yearId: number) {
    const year = await this.model.findYearById(yearId);
    if (!year || Number(year.is_active) !== 1) {
      return { ok: false, status: StatusCodes.NOT_FOUND, error: 'TAX_YEAR_NOT_FOUND' } as const;
    }

    const hospcode = String(year.hospcode);
    const scopeValidation = this.validateScope(auth, hospcode);
    if (!scopeValidation.ok) return scopeValidation;

    return {
      ok: true,
      yearId: Number(year.id),
      yearBe: Number(year.year_be),
      yearShort: this.toYearShort(Number(year.year_be)),
      hospcode
    } as const;
  }

  private parseMappingTxt(buffer: Buffer) {
    const text = buffer.toString('utf8');
    const lines = text
      .split(/\r\n|\n|\r/)
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      })
      .filter((line) => line.length > 0);

    if (!lines.length) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'EMPTY_TXT_FILE' } as const;
    }

    const sample = lines[0];
    const pipeCount = (sample.match(/\|/g) || []).length;
    const dollarCount = (sample.match(/\$/g) || []).length;
    const delimiter = pipeCount > 0 && pipeCount >= dollarCount ? '|' : '$';

    const cids: string[] = [];
    const invalidRows: Array<{ line: number; raw: string }> = [];

    lines.forEach((line, index) => {
      const fields = line.split(delimiter);
      const rawId = String(fields[4] ?? '').trim();
      const cid = rawId.replace(/\D/g, '');
      if (!CID_REGEX.test(cid)) {
        invalidRows.push({ line: index + 1, raw: rawId });
        return;
      }

      cids.push(cid);
    });

    if (invalidRows.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'TXT_PATTERN_INVALID',
        data: {
          delimiter,
          invalidRows: invalidRows.slice(0, 20)
        }
      } as const;
    }

    return {
      ok: true,
      delimiter,
      cids
    } as const;
  }

  private async validateIndividualPdfPages(items: IndividualUploadItem[]) {
    const invalidPageItems: Array<{ line: number; cid: string; fileName: string; pageCount: number }> = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let pdf: PDFDocument;
      try {
        pdf = await PDFDocument.load(item.buffer);
      } catch (_error) {
        return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_PDF_FILE' } as const;
      }

      const pageCount = pdf.getPageCount();
      if (pageCount !== 1) {
        invalidPageItems.push({
          line: index + 1,
          cid: item.cid.trim(),
          fileName: item.originalName,
          pageCount
        });
      }
    }

    if (invalidPageItems.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INDIVIDUAL_PDF_MUST_HAVE_SINGLE_PAGE',
        data: {
          invalidRows: invalidPageItems.slice(0, 20)
        }
      } as const;
    }

    return { ok: true } as const;
  }

  private async buildUploadPlan(input: { year: AccessibleYearInfo; cids: string[] }) {
    const uniqueCids = [...new Set(input.cids)];
    const currentMaxMap = await this.model.getMaxFileNoByYearBeAndCids(input.year.yearBe, uniqueCids);
    const runningMap = new Map(currentMaxMap);
    const plan: UploadPlanItem[] = [];

    input.cids.forEach((rawCid) => {
      const cid = rawCid.trim();
      const nextFileNo = (runningMap.get(cid) ?? 0) + 1;
      runningMap.set(cid, nextFileNo);

      const fileName = this.buildFileName(input.year.yearShort, cid, nextFileNo);
      const relativePath = this.buildRelativePath(input.year.yearShort, input.year.hospcode, fileName);

      plan.push({
        cid,
        fileNo: nextFileNo,
        fileName,
        relativePath
      });
    });

    return plan;
  }

  private async prepareBatchUpload(year: AccessibleYearInfo, sourcePdfBuffer: Buffer, mappingTxtBuffer: Buffer) {
    const mapping = this.parseMappingTxt(mappingTxtBuffer);
    if (!mapping.ok) return mapping;

    let sourcePdf: PDFDocument;
    try {
      sourcePdf = await PDFDocument.load(sourcePdfBuffer);
    } catch (_error) {
      return { ok: false, status: StatusCodes.BAD_REQUEST, error: 'INVALID_PDF_FILE' } as const;
    }

    const pageCount = sourcePdf.getPageCount();
    if (pageCount !== mapping.cids.length) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'PDF_PAGE_COUNT_MISMATCH_TXT_LINES',
        data: {
          pageCount,
          lineCount: mapping.cids.length
        }
      } as const;
    }

    const plan = await this.buildUploadPlan({
      year,
      cids: mapping.cids
    });

    return {
      ok: true,
      sourcePdf,
      pageCount,
      lineCount: mapping.cids.length,
      delimiter: mapping.delimiter,
      plan
    } as const;
  }

  private buildFileName(yearShort: string, cid: string, fileNo: number) {
    return `${yearShort}_${cid}_${fileNo}.pdf`;
  }

  private buildRelativePath(yearShort: string, hospcode: string, fileName: string) {
    return path.posix.join(yearShort, hospcode, fileName);
  }

  private resolveStoragePath(relativePath: string) {
    const storageRoot = path.resolve(STORAGE_ROOT);
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized.includes('\0')) {
      throw new Error('INVALID_STORAGE_PATH');
    }

    const absolutePath = path.resolve(storageRoot, normalized);
    const relativeToRoot = path.relative(storageRoot, absolutePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error('INVALID_STORAGE_PATH');
    }

    return absolutePath;
  }

  private async writeBufferToStorage(absolutePath: string, buffer: Buffer) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);
  }

  private async removeFileIfExists(absolutePath: string) {
    try {
      await fs.unlink(absolutePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private validateScope(auth: AuthContext, hospcode: string) {
    if (auth.scopeType === 'ALL') {
      return { ok: true } as const;
    }

    if (auth.hospcodes.includes(hospcode)) {
      return { ok: true } as const;
    }

    return {
      ok: false,
      status: StatusCodes.FORBIDDEN,
      error: 'SCOPE_FORBIDDEN'
    } as const;
  }

  private resolveHospcodeForCreate(auth: AuthContext, rawHospcode?: string) {
    const hospcode = String(rawHospcode ?? '').trim();

    if (hospcode) {
      const scopeValidation = this.validateScope(auth, hospcode);
      if (!scopeValidation.ok) return scopeValidation;
      return { ok: true, hospcode } as const;
    }

    if (auth.scopeType === 'LIST' && auth.hospcodes.length === 1) {
      return { ok: true, hospcode: auth.hospcodes[0] } as const;
    }

    return {
      ok: false,
      status: StatusCodes.BAD_REQUEST,
      error: 'HOSPCODE_REQUIRED'
    } as const;
  }

  private normalizeYearBe(rawYear: number) {
    const year = Number(rawYear);
    if (!Number.isInteger(year)) {
      return {
        ok: false,
        status: StatusCodes.BAD_REQUEST,
        error: 'INVALID_YEAR_BE'
      } as const;
    }

    if (year >= 2400 && year <= 2700) {
      return { ok: true, yearBe: year } as const;
    }

    if (year >= 0 && year <= 99) {
      return { ok: true, yearBe: 2500 + year } as const;
    }

    return {
      ok: false,
      status: StatusCodes.BAD_REQUEST,
      error: 'INVALID_YEAR_BE'
    } as const;
  }

  private toYearShort(yearBe: number) {
    return String(yearBe % 100).padStart(2, '0');
  }
}
