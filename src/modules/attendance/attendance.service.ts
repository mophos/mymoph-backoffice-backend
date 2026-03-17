import type { AuthContext } from '../../shared/types/auth';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { config } from '../../config/env';
import { AttendanceModel } from './attendance.model';

const PDFDocument: any = require('pdfkit');

interface DashboardQuery {
  from: string;
  to: string;
  effectiveHospcodes: string[];
}

interface ListQuery extends DashboardQuery {
  page: number;
  pageSize: number;
  offset: number;
  search?: string;
}

interface ExportQuery extends DashboardQuery {
  reportType: 'daily' | 'monthly';
  search?: string;
}

export class AttendanceService {
  constructor(private readonly attendanceModel: AttendanceModel) { }

  async getDashboard(auth: AuthContext, query: DashboardQuery) {
    const summary = await this.attendanceModel.getDashboardSummary({
      hospcodes: query.effectiveHospcodes,
      scopeType: auth.scopeType,
      from: query.from,
      to: query.to
    });

    return {
      from: query.from,
      to: query.to,
      timezone: 'Asia/Bangkok',
      scopeType: auth.scopeType,
      hospcodes: auth.scopeType === 'ALL' ? 'ALL' : query.effectiveHospcodes,
      summary
    };
  }

  async listRecords(auth: AuthContext, query: ListQuery) {
    const records = await this.attendanceModel.listAttendanceRecords({
      hospcodes: query.effectiveHospcodes,
      scopeType: auth.scopeType,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
      offset: query.offset,
      search: query.search
    });

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: records.total,
      rows: records.rows.map((row: any) => ({
        ...row,
        cid: this.maskCid(row.cid)
      }))
    };
  }

  async exportReport(auth: AuthContext, query: ExportQuery): Promise<{ filename: string; fileBuffer: Buffer }> {
    const summary = await this.attendanceModel.getDashboardSummary({
      hospcodes: query.effectiveHospcodes,
      scopeType: auth.scopeType,
      from: query.from,
      to: query.to
    });

    const attendanceRows = await this.attendanceModel.listAttendanceRecordsForExport({
      hospcodes: query.effectiveHospcodes,
      scopeType: auth.scopeType,
      from: query.from,
      to: query.to,
      search: query.search
    });

    const personnelRows = await this.attendanceModel.listPersonnelProfilesForExport({
      scopeType: auth.scopeType,
      hospcodes: query.effectiveHospcodes
    });

    const rows = this.mergeRowsWithPersonnelCoverage({
      reportType: query.reportType,
      from: query.from,
      to: query.to,
      attendanceRows,
      personnelRows
    });

    const workbook = this.buildWorkbook({
      reportType: query.reportType,
      from: query.from,
      to: query.to,
      summary,
      rows
    });

    const output = await workbook.xlsx.writeBuffer();
    const fileBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);

    return {
      filename: this.buildExportFilename(query.reportType, query.from, query.to),
      fileBuffer
    };
  }

  async exportPdfReport(auth: AuthContext, query: ExportQuery): Promise<{ filename: string; fileBuffer: Buffer }> {
    const attendanceRows = await this.attendanceModel.listAttendanceRecordsForExport({
      hospcodes: query.effectiveHospcodes,
      scopeType: auth.scopeType,
      from: query.from,
      to: query.to,
      search: query.search
    });

    const personnelRows = await this.attendanceModel.listPersonnelProfilesForExport({
      scopeType: auth.scopeType,
      hospcodes: query.effectiveHospcodes
    });

    const rows = this.mergeRowsWithPersonnelCoverage({
      reportType: query.reportType,
      from: query.from,
      to: query.to,
      attendanceRows,
      personnelRows
    });

    const fileBuffer = await this.buildPdfBuffer({
      reportType: query.reportType,
      from: query.from,
      to: query.to,
      rows
    });

    return {
      filename: this.buildPdfFilename(query.reportType, query.from, query.to),
      fileBuffer
    };
  }

  private maskCid(value: unknown): string {
    const cid = String(value ?? '').trim();
    if (!cid) return '';
    if (cid.length <= 8) return cid;

    const head = cid.slice(0, 8);
    const tail = cid.length > 12 ? cid.slice(12) : '';
    return `${head}***${tail}`;
  }

  private buildExportFilename(reportType: 'daily' | 'monthly', from: string, to: string): string {
    if (reportType === 'daily') {
      return `attendance_daily_${from}.xlsx`;
    }

    if (from.slice(0, 7) === to.slice(0, 7)) {
      return `attendance_monthly_${from.slice(0, 7)}.xlsx`;
    }

    return `attendance_monthly_${from}_to_${to}.xlsx`;
  }

  private buildPdfFilename(reportType: 'daily' | 'monthly', from: string, to: string): string {
    if (reportType === 'daily') {
      return `attendance_daily_${from}.pdf`;
    }

    if (from.slice(0, 7) === to.slice(0, 7)) {
      return `attendance_monthly_${from.slice(0, 7)}.pdf`;
    }

    return `attendance_monthly_${from}_to_${to}.pdf`;
  }

  private buildWorkbook(input: {
    reportType: 'daily' | 'monthly';
    from: string;
    to: string;
    summary: any;
    rows: any[];
  }): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MyMOPH Backoffice';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'รายการ', key: 'col1', width: 34 },
      { header: '', key: 'col2', width: 30 },
      { header: '', key: 'col3', width: 24 },
      { header: '', key: 'col4', width: 24 }
    ];

    summarySheet.addRow(['รายงานการลงเวลาเข้างาน-ออกงาน', input.reportType === 'daily' ? 'รายวัน' : 'รายเดือน']);
    summarySheet.addRow(['ช่วงวันที่', `${input.from} ถึง ${input.to}`]);
    summarySheet.addRow(['วันที่ออกรายงาน', dayjs().format('YYYY-MM-DD HH:mm:ss')]);
    // summarySheet.addRow(['เขตเวลา', 'Asia/Bangkok']);
    summarySheet.addRow([]);

    if (input.reportType === 'daily') {
      const metricHeaderRow = summarySheet.addRow(['ตัวชี้วัด', 'จำนวน']);
      summarySheet.addRow(['จำนวนรายการทั้งหมด (total_records)', Number(input.summary?.total_records ?? 0)]);
      summarySheet.addRow(['จำนวนที่มีเวลาเข้างาน', Number(input.summary?.checked_in_count ?? 0)]);
      summarySheet.addRow(['จำนวนที่มีเวลาออกงาน', Number(input.summary?.checked_out_count ?? 0)]);

      summarySheet.getRow(1).font = { bold: true, size: 13 };
      metricHeaderRow.font = { bold: true };
      metricHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE9EEF6' }
      };
    }
    if (input.reportType === 'monthly') {
      summarySheet.addRow([]);
      const dailyTitleRow = summarySheet.addRow(['สรุปรายวัน']);
      dailyTitleRow.font = { bold: true };

      const dailyHeaderRow = summarySheet.addRow([
        'วันที่',
        'จำนวนรายการทั้งหมด',
        'จำนวนที่มีเวลาเข้างาน',
        'จำนวนที่มีเวลาออกงาน'
      ]);
      dailyHeaderRow.font = { bold: true };
      dailyHeaderRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE9EEF6' }
      };

      const dailySummaryRows = this.buildDailySummaryRows(input.rows);
      if (!dailySummaryRows.length) {
        summarySheet.addRow(['-', 0, 0, 0]);
      } else {
        dailySummaryRows.forEach((row) => {
          summarySheet.addRow([
            row.dateLabel,
            row.totalRecords,
            row.checkedInCount,
            row.checkedOutCount
          ]);
        });
      }
    }

    const detailsSheet = workbook.addWorksheet('Details');
    detailsSheet.columns = [
      { header: 'No', key: 'no', width: 8 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'CID', key: 'cid', width: 18 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Hospcode', key: 'hospcode', width: 12 },
      { header: 'Check-in', key: 'checkIn', width: 14 },
      { header: 'Check-out', key: 'checkOut', width: 14 },
      { header: 'เวลาปฏิบัติงาน', key: 'workDuration', width: 18 },
      { header: 'Status', key: 'status', width: 16 }
    ];

    input.rows.forEach((row, index) => {
      detailsSheet.addRow({
        no: index + 1,
        date: this.formatDate(row.attendance_date),
        cid: this.maskCid(row.cid),
        name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        hospcode: row.hospcode ?? '',
        checkIn: this.formatTime(row.check_in_at),
        checkOut: this.formatTime(row.check_out_at),
        workDuration: this.formatWorkDuration(row.check_in_at, row.check_out_at),
        status: this.getStatus(row.check_in_at, row.check_out_at)
      });
    });

    detailsSheet.getRow(1).font = { bold: true };
    detailsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE9EEF6' }
    };

    return workbook;
  }

  private formatDate(value: unknown): string {
    if (!value) return '';
    return dayjs(value as any).format('DD/MM/YYYY');
  }

  private formatTime(value: unknown): string {
    if (!value) return '-';
    return dayjs(value as any).format('HH:mm');
  }

  private getStatus(checkInAt: unknown, checkOutAt: unknown): string {
    if (checkInAt && checkOutAt) return 'Completed';
    if (checkInAt) return 'Checked-in';
    return 'No Check-in';
  }

  private formatWorkDuration(checkInAt: unknown, checkOutAt: unknown): string {
    if (!checkInAt || !checkOutAt) return '-';

    const start = dayjs(checkInAt as any);
    const end = dayjs(checkOutAt as any);
    const totalMinutes = end.diff(start, 'minute');

    if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '-';

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private mergeRowsWithPersonnelCoverage(input: {
    reportType: 'daily' | 'monthly';
    from: string;
    to: string;
    attendanceRows: any[];
    personnelRows: any[];
  }): any[] {
    const mergedRows = input.attendanceRows.map((row) => ({ ...row }));
    if (!input.personnelRows.length) {
      return mergedRows;
    }

    const personnelByKey = new Map<string, any>();
    for (const personnel of input.personnelRows) {
      const cid = String(personnel.cid ?? '').trim();
      const hospcode = String(personnel.hospcode ?? '').trim();
      if (!cid || !hospcode) continue;
      personnelByKey.set(`${cid}|${hospcode}`, personnel);
    }

    const attendanceByKey = new Map<string, any>();
    for (const row of mergedRows) {
      const cid = String(row.cid ?? '').trim();
      const hospcode = String(row.hospcode ?? '').trim();
      const dateKey = this.toDateKey(row.attendance_date);
      if (!cid || !hospcode || !dateKey) continue;

      const key = `${cid}|${hospcode}|${dateKey}`;
      if (!attendanceByKey.has(key)) {
        attendanceByKey.set(key, row);
      }

      const personnel = personnelByKey.get(`${cid}|${hospcode}`);
      if (personnel) {
        if (!row.first_name) row.first_name = personnel.first_name ?? null;
        if (!row.last_name) row.last_name = personnel.last_name ?? null;
      }
    }

    const dates = this.getDateRange(input.from, input.to, input.reportType);
    for (const personnel of input.personnelRows) {
      const cid = String(personnel.cid ?? '').trim();
      const hospcode = String(personnel.hospcode ?? '').trim();
      if (!cid || !hospcode) continue;

      for (const dateKey of dates) {
        const key = `${cid}|${hospcode}|${dateKey}`;
        if (attendanceByKey.has(key)) continue;

        const syntheticRow = {
          id: null,
          cid,
          attendance_date: dateKey,
          check_in_at: null,
          check_out_at: null,
          hospcode,
          first_name: personnel.first_name ?? null,
          last_name: personnel.last_name ?? null
        };

        mergedRows.push(syntheticRow);
        attendanceByKey.set(key, syntheticRow);
      }
    }

    return mergedRows.sort((a, b) => {
      const dateA = this.toDateKey(a.attendance_date) || '';
      const dateB = this.toDateKey(b.attendance_date) || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      const hospA = String(a.hospcode ?? '');
      const hospB = String(b.hospcode ?? '');
      if (hospA !== hospB) return hospA.localeCompare(hospB);

      const cidA = String(a.cid ?? '');
      const cidB = String(b.cid ?? '');
      return cidA.localeCompare(cidB);
    });
  }

  private getDateRange(from: string, to: string, reportType: 'daily' | 'monthly'): string[] {
    if (reportType === 'daily') {
      return [from];
    }

    const start = dayjs(from);
    const end = dayjs(to);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      return [from];
    }

    const dates: string[] = [];
    let current = start.startOf('day');
    const endDay = end.startOf('day');

    while (current.isBefore(endDay) || current.isSame(endDay, 'day')) {
      dates.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    return dates;
  }

  private toDateKey(value: unknown): string | null {
    if (!value) return null;
    const parsed = dayjs(value as any);
    if (!parsed.isValid()) return null;
    return parsed.format('YYYY-MM-DD');
  }

  private async buildPdfBuffer(input: {
    reportType: 'daily' | 'monthly';
    from: string;
    to: string;
    rows: any[];
  }): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error: unknown) => reject(error));
    });

    this.applyPdfFont(doc);

    if (input.reportType === 'daily') {
      this.renderPdfDailyPage(doc, {
        reportDate: input.from,
        generatedAt: dayjs().format('DD/MM/YYYY HH:mm:ss'),
        rows: input.rows,
        isMonthlyMode: false
      });
    } else {
      const rowsByDate = this.groupRowsByDate(input.rows);
      const dateKeys = [...rowsByDate.keys()].sort((a, b) => a.localeCompare(b));

      if (!dateKeys.length) {
        this.renderPdfDailyPage(doc, {
          reportDate: input.from,
          generatedAt: dayjs().format('DD/MM/YYYY HH:mm:ss'),
          rows: [],
          isMonthlyMode: true
        });
      } else {
        dateKeys.forEach((dateKey, index) => {
          if (index > 0) {
            doc.addPage();
            this.applyPdfFont(doc);
          }

          this.renderPdfDailyPage(doc, {
            reportDate: dateKey,
            generatedAt: dayjs().format('DD/MM/YYYY HH:mm:ss'),
            rows: rowsByDate.get(dateKey) ?? [],
            isMonthlyMode: true
          });
        });
      }
    }

    doc.end();
    return done;
  }

  private renderPdfDailyPage(doc: any, input: {
    reportDate: string;
    generatedAt: string;
    rows: any[];
    isMonthlyMode: boolean;
  }) {
    const tableWidths = [70, 120, 65, 65, 65, 130];
    const rowHeight = 24;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    const drawPageHeader = (continued: boolean): number => {
      doc.fontSize(16).text('รายงานสรุปเวลาเข้าออกประจำวัน', {
        align: 'center'
      });

      const dateLabel = this.formatDate(input.reportDate);
      const subTitle = input.isMonthlyMode
        ? `ประจำวันที่ ${dateLabel}${continued ? ' (ต่อ)' : ''}`
        : `วันที่ ${dateLabel}${continued ? ' (ต่อ)' : ''}`;
      doc.fontSize(12).text(subTitle, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`วันเวลาที่ออก pdf: ${input.generatedAt}`);
      doc.moveDown(0.4);
      return doc.y + 6;
    };

    const drawTableHeader = (startY: number): number => {
      const headers = ['วันที่', 'ชื่อ-นามสกุล', 'เวลาเข้างาน', 'เวลาออกงาน', 'เวลารวม', 'หมายเหตุ'];
      let x = doc.page.margins.left;
      doc.fontSize(10);
      for (let i = 0; i < headers.length; i += 1) {
        const width = tableWidths[i];
        doc.rect(x, startY, width, rowHeight).stroke();
        doc.text(headers[i], x + 4, startY + 7, { width: width - 8, align: 'center' });
        x += width;
      }
      return startY + rowHeight;
    };

    const drawTableRow = (startY: number, row: any): number => {
      const values = [
        this.formatDate(row.attendance_date),
        this.buildFullName(row),
        this.formatTime(row.check_in_at),
        this.formatTime(row.check_out_at),
        this.formatWorkDuration(row.check_in_at, row.check_out_at),
        this.getPdfRemark(row.check_in_at, row.check_out_at)
      ];

      let x = doc.page.margins.left;
      doc.fontSize(10);
      for (let i = 0; i < values.length; i += 1) {
        const width = tableWidths[i];
        doc.rect(x, startY, width, rowHeight).stroke();
        const align = i === 1 || i === 5 ? 'left' : 'center';
        doc.text(values[i], x + 4, startY + 7, { width: width - 8, align });
        x += width;
      }
      return startY + rowHeight;
    };

    let y = drawPageHeader(false);
    y = drawTableHeader(y);

    if (!input.rows.length) {
      const emptyRow = {
        attendance_date: input.reportDate,
        check_in_at: null,
        check_out_at: null
      };
      y = drawTableRow(y, emptyRow);
    } else {
      for (const row of input.rows) {
        if (y + rowHeight > bottomLimit - 40) {
          doc.addPage();
          this.applyPdfFont(doc);
          y = drawPageHeader(true);
          y = drawTableHeader(y);
        }
        y = drawTableRow(y, row);
      }
    }

    if (y + 30 > bottomLimit) {
      doc.addPage();
      this.applyPdfFont(doc);
      y = drawPageHeader(true);
    }

    const totalPeople = this.countDistinctPeople(input.rows);
    doc.fontSize(12).text(`สรุปผลทั้งหมด ${totalPeople} คน`, doc.page.margins.left, y + 10);
  }

  private getPdfRemark(checkInAt: unknown, checkOutAt: unknown): string {
    if (checkInAt && checkOutAt) return 'ปฏิบัติงานครบ';
    if (checkInAt) return 'ยังไม่เช็กเอาต์';
    return 'ไม่พบเช็กอิน';
  }

  private buildFullName(row: any): string {
    const firstName = String(row?.first_name ?? '').trim();
    const lastName = String(row?.last_name ?? '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || '-';
  }

  private groupRowsByDate(rows: any[]): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const row of rows) {
      const key = dayjs(row.attendance_date).format('YYYY-MM-DD');
      const current = map.get(key) ?? [];
      current.push(row);
      map.set(key, current);
    }
    return map;
  }

  private countDistinctPeople(rows: any[]): number {
    if (!rows.length) return 0;
    const cidSet = new Set<string>();
    rows.forEach((row) => {
      const cid = String(row.cid ?? '').trim();
      if (cid) cidSet.add(cid);
    });
    return cidSet.size;
  }

  private applyPdfFont(doc: any): void {
    const fontPath = this.resolveThaiFontPath();
    if (fontPath) {
      doc.font(fontPath);
      return;
    }

    doc.font('Helvetica');
  }

  private resolveThaiFontPath(): string | null {
    const candidatePaths = [
      config.pdf?.fontPath,
      '/System/Library/Fonts/Supplemental/Thonburi.ttf',
      '/Library/Fonts/THSarabunNew.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf'
    ];

    for (const candidate of candidatePaths) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private buildDailySummaryRows(rows: any[]): Array<{
    dateLabel: string;
    totalRecords: number;
    checkedInCount: number;
    checkedOutCount: number;
  }> {
    const map = new Map<string, {
      dateLabel: string;
      totalRecords: number;
      checkedInCount: number;
      checkedOutCount: number;
    }>();

    for (const row of rows) {
      const dateKey = dayjs(row.attendance_date).format('YYYY-MM-DD');
      const existing = map.get(dateKey) ?? {
        dateLabel: dayjs(row.attendance_date).format('DD/MM/YYYY'),
        totalRecords: 0,
        checkedInCount: 0,
        checkedOutCount: 0
      };

      existing.totalRecords += 1;
      if (row.check_in_at) existing.checkedInCount += 1;
      if (row.check_out_at) existing.checkedOutCount += 1;

      map.set(dateKey, existing);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);
  }
}
