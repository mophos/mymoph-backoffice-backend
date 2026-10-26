import path from 'path';
import fs from 'fs/promises';
import { systemDb } from '../db/knex';

/**
 * ตรวจว่าข้อมูลใบรับรองภาษีในฐาน ตรงกับไฟล์จริงบนดิสก์หรือไม่
 *
 * สคริปต์นี้ **อ่านอย่างเดียว** ไม่เขียนฐาน ไม่แก้ไม่ลบไฟล์ใด
 * สิ่งเดียวที่เขียนคือไฟล์รายงานในโฟลเดอร์ที่สั่งด้วย --out
 *
 * ตรวจสองครึ่งที่ไม่เกี่ยวกัน สั่งแยกกันได้
 *
 *   ครึ่ง A (--storage)  tax_documents  <->  storage/tax ของหลังบ้านนี้
 *                        ตอบว่า "แถวที่มีในฐาน มีไฟล์จริงครบไหม และมีไฟล์ที่ไม่มีใครอ้างถึงไหม"
 *
 *   ครึ่ง B (--legacy)   โฟลเดอร์ของเก่าที่ mymoph-api อ่านตรง (TAX_PDF_PATH)  <->  ฐาน
 *                        ตอบว่า "ของเก่ามีกี่ไฟล์ ปีอะไร แยกหน่วยงานไว้ไหม และอันไหนยังไม่เข้าฐาน"
 *
 * ค่า TAX_PDF_PATH ไม่ต้องบอกใคร ส่งเข้ามาทาง --legacy ตอนรันบน server ได้เลย
 */

interface CliOptions {
  storageDir: string | null;
  storageListPath: string | null;
  legacyDir: string | null;
  legacyListPath: string | null;
  outDir: string;
  sampleLimit: number;
  pageCheckLimit: number;
}

const usage = `
ใช้งาน:
  npx tsx src/scripts/tax-audit-files.ts --out=/abs/path/report [ตัวเลือก]

ตัวเลือก
  --storage=<dir>     โฟลเดอร์เก็บไฟล์ของหลังบ้านนี้ (ค่าเริ่มต้น <cwd>/storage/tax)
                      ใส่ --storage=off เพื่อข้ามครึ่ง A
  --legacy=<dir>      โฟลเดอร์ไฟล์ของเก่าที่แอปอ่านตรง (ค่าเดียวกับ TAX_PDF_PATH)
                      ไม่ใส่ = ข้ามครึ่ง B

  --storage-list=<f>  ใช้ "รายการไฟล์" แทนการเดินโฟลเดอร์จริง สำหรับครึ่ง A
  --legacy-list=<f>   เหมือนกัน สำหรับครึ่ง B
                      ใช้ตอนที่ไฟล์จริงอยู่บน server แต่จะวิเคราะห์บนอีกเครื่อง
                      สร้างรายการบน server ด้วยคำสั่งนี้ ไม่ต้องมี node หรือ tsx

                        cd <โฟลเดอร์ที่จะตรวจ>
                        find . -type f -printf '%P\t%s\n' > ~/tax-files.tsv

                      รองรับทั้งแบบมีขนาด (คั่นด้วย tab) และแบบมีแต่ path
  --out=<dir>         โฟลเดอร์สำหรับเขียนรายงาน (บังคับ) สร้างให้ถ้ายังไม่มี
  --sample=<n>        จำนวนตัวอย่างต่อหนึ่งหัวข้อที่พิมพ์ลงจอ (ค่าเริ่มต้น 10)
                      ใส่ 0 เพื่อให้พิมพ์แต่จำนวน ไม่พิมพ์เลขบัตรหรือชื่อไฟล์ลงจอ
  --check-pages=<n>   สุ่มเปิด PDF ของเก่า n ไฟล์เพื่อนับจำนวนหน้า (ค่าเริ่มต้น 0 = ไม่เปิด)

สคริปต์นี้อ่านอย่างเดียว รันซ้ำได้ ไม่กระทบข้อมูล
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const raw = item.slice(2);
    if (!raw) continue;

    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      result[key] = rest.join('=');
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[raw] = next;
      index += 1;
      continue;
    }

    result[raw] = true;
  }

  return result;
}

function readOptions(): CliOptions {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(usage);
    process.exit(0);
  }

  const outDir = typeof args.out === 'string' ? args.out.trim() : '';
  if (!outDir) {
    console.log(usage);
    throw new Error('ต้องระบุ --out=<dir>');
  }

  const rawStorage = typeof args.storage === 'string' ? args.storage.trim() : '';
  const storageDir =
    rawStorage.toLowerCase() === 'off'
      ? null
      : path.resolve(rawStorage || path.join(process.cwd(), 'storage', 'tax'));

  const rawLegacy = typeof args.legacy === 'string' ? args.legacy.trim() : '';
  const rawStorageList = typeof args['storage-list'] === 'string' ? args['storage-list'].trim() : '';
  const rawLegacyList = typeof args['legacy-list'] === 'string' ? args['legacy-list'].trim() : '';

  return {
    storageDir,
    storageListPath: rawStorageList ? path.resolve(rawStorageList) : null,
    legacyDir: rawLegacy ? path.resolve(rawLegacy) : null,
    legacyListPath: rawLegacyList ? path.resolve(rawLegacyList) : null,
    outDir: path.resolve(outDir),
    sampleLimit: Number.isFinite(Number(args.sample)) && args.sample !== undefined
      ? Math.max(0, Math.floor(Number(args.sample)))
      : 10,
    pageCheckLimit: Number(args['check-pages']) > 0 ? Math.floor(Number(args['check-pages'])) : 0
  };
}

/** ปีสองหลักที่ใช้เป็นทั้งคำนำหน้าชื่อไฟล์และชื่อโฟลเดอร์ชั้นแรก */
function yearShort(yearBe: number): string {
  return String(yearBe % 100).padStart(2, '0');
}

interface DiskFile {
  relativePath: string;
  size: number;
}

/** เดินทุกชั้นของโฟลเดอร์ คืน path แบบ relative ด้วย / เสมอ เพื่อเทียบกับค่าในฐานได้ตรง */
async function walkFiles(rootDir: string): Promise<DiskFile[]> {
  const found: DiskFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      let size = -1;
      try {
        const info = await fs.stat(fullPath);
        size = info.size;
      } catch {
        // อ่าน stat ไม่ได้ ปล่อยเป็น -1 แล้วรายงานรวมกับไฟล์ว่าง
      }

      found.push({
        relativePath: path.relative(rootDir, fullPath).split(path.sep).join('/'),
        size
      });
    }
  }

  await walk(rootDir);
  return found;
}

/**
 * อ่าน "รายการไฟล์" ที่สร้างไว้บนเครื่องอื่น แทนการเดินโฟลเดอร์จริง
 *
 * รูปแบบที่คาดไว้คือผลของ find -printf '%P\t%s\n'
 * แต่ยอมรับแบบมีแต่ path ด้วย กรณีนั้นถือว่าไม่รู้ขนาด (-1) และจะไม่ตรวจไฟล์ว่าง
 */
async function readFileList(listPath: string): Promise<{ files: DiskFile[]; withoutSize: number }> {
  const raw = await fs.readFile(listPath, 'utf8');
  const files: DiskFile[] = [];
  let withoutSize = 0;

  for (const line of raw.split('\n')) {
    const text = line.replace(/\r$/, '');
    if (!text.trim()) continue;

    // ตัดคอลัมน์ขนาดออกจากท้ายบรรทัด ไม่ใช้ split เพราะชื่อไฟล์อาจมี tab ได้
    const tabAt = text.lastIndexOf('\t');
    let relativePath = text;
    let size = -1;

    if (tabAt >= 0) {
      const tail = text.slice(tabAt + 1).trim();
      if (/^\d+$/.test(tail)) {
        relativePath = text.slice(0, tabAt);
        size = Number(tail);
      }
    }

    if (size < 0) withoutSize += 1;

    relativePath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!relativePath) continue;

    files.push({ relativePath, size });
  }

  return { files, withoutSize };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await fs.stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    const info = await fs.stat(dir);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function writeCsv(filePath: string, header: string[], rows: unknown[][]): Promise<void> {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function countBy<T>(items: T[], pick: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function printSection(title: string): void {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

function printFinding(label: string, rows: unknown[][], sampleLimit: number): void {
  if (!rows.length) {
    console.log(`  ok   ${label}: ไม่พบ`);
    return;
  }

  console.log(`  พบ   ${label}: ${rows.length} รายการ`);
  for (const row of rows.slice(0, sampleLimit)) {
    console.log(`         ${row.join(' | ')}`);
  }
  if (rows.length > sampleLimit) {
    console.log(`         ... อีก ${rows.length - sampleLimit} รายการ ดูในไฟล์รายงาน`);
  }
}

// ─────────────────────────── ครึ่ง A ───────────────────────────

interface DocumentRow {
  id: string;
  tax_year_id: number;
  year_be: number;
  hospcode: string;
  cid: string;
  file_no: number;
  file_name: string;
  relative_path: string;
  source_type: string;
  is_active: number;
}

interface YearRow {
  id: number;
  year_be: number;
  hospcode: string;
  is_active: number;
}

async function auditStorage(options: CliOptions, outDir: string) {
  const useList = options.storageListPath !== null;
  const storageDir = options.storageDir as string;
  const sourceLabel = useList ? `รายการไฟล์ ${options.storageListPath}` : storageDir;

  printSection(`ครึ่ง A — ฐาน tax_documents เทียบ ${sourceLabel}`);

  let diskFiles: DiskFile[];
  let sizesKnown = true;

  if (useList) {
    const listPath = options.storageListPath as string;
    if (!(await fileExists(listPath))) {
      console.log(`  หยุด  ไม่พบไฟล์รายการ ${listPath}`);
      return { skipped: true, reason: 'STORAGE_LIST_NOT_FOUND', source: sourceLabel };
    }

    const list = await readFileList(listPath);
    diskFiles = list.files;
    sizesKnown = list.withoutSize === 0;
    console.log(`  อ่านรายการไฟล์: ${diskFiles.length} บรรทัด`);
    if (!sizesKnown) {
      console.log(`         ${list.withoutSize} บรรทัดไม่มีคอลัมน์ขนาด จะข้ามการตรวจไฟล์ว่าง`);
    }
  } else {
    if (!(await directoryExists(storageDir))) {
      console.log(`  ข้าม  ไม่พบโฟลเดอร์ ${storageDir}`);
      console.log('        ถ้ารันบนเครื่อง dev เป็นเรื่องปกติ ไฟล์จริงอยู่บน server');
      console.log('        ใช้ --storage-list=<ไฟล์รายการจาก server> เพื่อตรวจจากเครื่องนี้ได้');
      return { skipped: true, reason: 'STORAGE_DIR_NOT_FOUND', source: sourceLabel };
    }
    diskFiles = await walkFiles(storageDir);
  }

  const years: YearRow[] = await systemDb('tax_years').select(
    'id',
    'year_be',
    'hospcode',
    'is_active'
  );
  const yearById = new Map<number, YearRow>(years.map((row) => [Number(row.id), row]));

  const documents: DocumentRow[] = await systemDb('tax_documents').select(
    'id',
    'tax_year_id',
    'year_be',
    'hospcode',
    'cid',
    'file_no',
    'file_name',
    'relative_path',
    'source_type',
    'is_active'
  );

  const sizeByPath = new Map<string, number>(diskFiles.map((file) => [file.relativePath, file.size]));

  console.log(`  แถวในฐาน: ${documents.length} (ใช้งานอยู่ ${documents.filter((d) => Number(d.is_active) === 1).length})`);
  console.log(`  ปีภาษี: ${years.length} (ใช้งานอยู่ ${years.filter((y) => Number(y.is_active) === 1).length})`);
  console.log(`  ไฟล์บนดิสก์: ${diskFiles.length}`);

  const missingFile: unknown[][] = [];
  const emptyFile: unknown[][] = [];
  const pathMismatch: unknown[][] = [];
  const orphanYear: unknown[][] = [];
  const inactiveYearWithDocs: unknown[][] = [];
  const inactiveDoc: unknown[][] = [];
  const pathSeen = new Map<string, string[]>();
  const claimedPaths = new Set<string>();

  for (const doc of documents) {
    const relativePath = String(doc.relative_path ?? '').replace(/\\/g, '/');
    const active = Number(doc.is_active) === 1;

    if (!active) {
      inactiveDoc.push([doc.id, doc.year_be, doc.hospcode, relativePath]);
      continue;
    }

    claimedPaths.add(relativePath);
    const ids = pathSeen.get(relativePath) ?? [];
    ids.push(String(doc.id));
    pathSeen.set(relativePath, ids);

    const size = sizeByPath.get(relativePath);
    if (size === undefined) {
      missingFile.push([doc.id, doc.year_be, doc.hospcode, doc.cid, doc.file_no, relativePath]);
    } else if (sizesKnown && size <= 0) {
      emptyFile.push([doc.id, doc.year_be, doc.hospcode, doc.cid, relativePath, size]);
    }

    const year = yearById.get(Number(doc.tax_year_id));
    if (!year) {
      orphanYear.push([doc.id, doc.tax_year_id, doc.year_be, doc.hospcode, relativePath]);
      continue;
    }

    if (Number(year.is_active) !== 1) {
      inactiveYearWithDocs.push([doc.id, year.id, year.year_be, year.hospcode, relativePath]);
    }

    // path ที่ถูกต้องสร้างจากปีของ tax_years ไม่ใช่ปีที่อยู่ในแถวเอกสาร (ดู TAX-12)
    const expected = `${yearShort(Number(year.year_be))}/${String(year.hospcode)}/${String(doc.file_name)}`;
    if (relativePath !== expected) {
      const reasons: string[] = [];
      const [gotYear = '', gotHospcode = '', ...gotRest] = relativePath.split('/');
      if (gotYear !== yearShort(Number(year.year_be))) reasons.push('โฟลเดอร์ปีไม่ตรง');
      if (gotHospcode !== String(year.hospcode)) reasons.push('โฟลเดอร์หน่วยงานไม่ตรง');
      if (gotRest.join('/') !== String(doc.file_name)) reasons.push('ชื่อไฟล์ไม่ตรง');
      if (Number(doc.year_be) !== Number(year.year_be)) reasons.push('year_be ของแถวไม่เท่าปีของ tax_years');

      pathMismatch.push([
        doc.id,
        doc.year_be,
        year.year_be,
        doc.hospcode,
        year.hospcode,
        relativePath,
        expected,
        reasons.join(' + ') || 'ไม่ทราบสาเหตุ'
      ]);
    }
  }

  const duplicatePath: unknown[][] = [];
  for (const [relativePath, ids] of pathSeen.entries()) {
    if (ids.length > 1) duplicatePath.push([relativePath, ids.length, ids.join(' ')]);
  }

  // ไฟล์ที่ไม่มีแถวใช้งานอยู่อ้างถึง แยกว่าเป็นเศษจากการลบหรือของไม่ทราบที่มา
  const orphanCandidates = diskFiles.filter((file) => !claimedPaths.has(file.relativePath));

  // ถาม delete log เป็นชุดละ 500 ไม่ยิง whereIn ก้อนใหญ่ใส่ฐานจริงทีเดียว
  const deletedPaths = new Set<string>();
  const CHUNK = 500;
  for (let index = 0; index < orphanCandidates.length; index += CHUNK) {
    const chunk = orphanCandidates.slice(index, index + CHUNK).map((file) => file.relativePath);
    const rows: { relative_path: string }[] = await systemDb('tax_document_delete_logs')
      .distinct('relative_path')
      .whereIn('relative_path', chunk);
    for (const row of rows) deletedPaths.add(String(row.relative_path));
  }

  const orphanFromDelete: unknown[][] = [];
  const orphanUnknown: unknown[][] = [];
  for (const file of orphanCandidates) {
    const row = [file.relativePath, file.size];
    if (deletedPaths.has(file.relativePath)) orphanFromDelete.push(row);
    else orphanUnknown.push(row);
  }

  printFinding('แถวใช้งานอยู่แต่ไม่มีไฟล์บนดิสก์ (ดาวน์โหลดจะพัง)', missingFile, options.sampleLimit);
  printFinding('ไฟล์มีอยู่แต่ขนาด 0 ไบต์', emptyFile, options.sampleLimit);
  printFinding('หลายแถวชี้ไฟล์เดียวกัน (ลบแถวหนึ่งจะทำให้อีกแถวพัง)', duplicatePath, options.sampleLimit);
  printFinding('relative_path ไม่ตรงกับที่ควรเป็นตามปีและหน่วยงานของ tax_years', pathMismatch, options.sampleLimit);
  printFinding('แถวชี้ไปปีภาษีที่ไม่มีอยู่', orphanYear, options.sampleLimit);
  printFinding('แถวใช้งานอยู่ใต้ปีภาษีที่ปิดไปแล้ว', inactiveYearWithDocs, options.sampleLimit);
  printFinding('แถวที่ is_active = 0 (ปกติการลบเป็นการลบจริง จึงไม่ควรมี)', inactiveDoc, options.sampleLimit);
  printFinding('ไฟล์ค้างที่เป็นเศษจากการลบ (ลบแถวสำเร็จแต่ลบไฟล์ไม่สำเร็จ)', orphanFromDelete, options.sampleLimit);
  printFinding('ไฟล์ค้างที่ไม่ทราบที่มา (ไม่มีแถวและไม่มีร่องรอยการลบ)', orphanUnknown, options.sampleLimit);

  await writeCsv(path.join(outDir, 'A-ไฟล์หาย.csv'), ['document_id', 'year_be', 'hospcode', 'cid', 'file_no', 'relative_path'], missingFile);
  await writeCsv(path.join(outDir, 'A-ไฟล์ว่าง.csv'), ['document_id', 'year_be', 'hospcode', 'cid', 'relative_path', 'size'], emptyFile);
  await writeCsv(path.join(outDir, 'A-path-ซ้ำ.csv'), ['relative_path', 'row_count', 'document_ids'], duplicatePath);
  await writeCsv(path.join(outDir, 'A-path-ไม่ตรง.csv'), ['document_id', 'doc_year_be', 'year_year_be', 'doc_hospcode', 'year_hospcode', 'relative_path', 'expected_path', 'reason'], pathMismatch);
  await writeCsv(path.join(outDir, 'A-ปีภาษีหาย.csv'), ['document_id', 'tax_year_id', 'year_be', 'hospcode', 'relative_path'], orphanYear);
  await writeCsv(path.join(outDir, 'A-ปีถูกปิดแต่มีไฟล์.csv'), ['document_id', 'tax_year_id', 'year_be', 'hospcode', 'relative_path'], inactiveYearWithDocs);
  await writeCsv(path.join(outDir, 'A-ไฟล์ค้างจากการลบ.csv'), ['relative_path', 'size'], orphanFromDelete);
  await writeCsv(path.join(outDir, 'A-ไฟล์ค้างไม่ทราบที่มา.csv'), ['relative_path', 'size'], orphanUnknown);

  return {
    skipped: false,
    source: sourceLabel,
    fromFileList: useList,
    sizesKnown,
    documentRows: documents.length,
    activeDocumentRows: documents.filter((d) => Number(d.is_active) === 1).length,
    taxYears: years.length,
    activeTaxYears: years.filter((y) => Number(y.is_active) === 1).length,
    filesOnDisk: diskFiles.length,
    bytesOnDisk: diskFiles.reduce((sum, file) => sum + Math.max(file.size, 0), 0),
    findings: {
      missingFile: missingFile.length,
      emptyFile: emptyFile.length,
      duplicatePath: duplicatePath.length,
      pathMismatch: pathMismatch.length,
      orphanYear: orphanYear.length,
      inactiveYearWithDocs: inactiveYearWithDocs.length,
      inactiveDoc: inactiveDoc.length,
      orphanFromDelete: orphanFromDelete.length,
      orphanUnknown: orphanUnknown.length
    },
    activeRowsByYear: countBy(
      documents.filter((d) => Number(d.is_active) === 1),
      (d) => String(d.year_be)
    ),
    filesByTopFolder: countBy(diskFiles, (file) => file.relativePath.split('/')[0] ?? '(root)')
  };
}

// ─────────────────────────── ครึ่ง B ───────────────────────────

const LEGACY_NAME_PATTERN = /^(\d{2})_(\d{13})(?:_(\d+))?\.pdf$/i;

async function auditLegacy(options: CliOptions, outDir: string) {
  const useList = options.legacyListPath !== null;
  const legacyDir = options.legacyDir;
  const sourceLabel = useList ? `รายการไฟล์ ${options.legacyListPath}` : String(legacyDir);

  printSection(`ครึ่ง B — ของเก่า ${sourceLabel}`);

  let diskFiles: DiskFile[];

  if (useList) {
    const listPath = options.legacyListPath as string;
    if (!(await fileExists(listPath))) {
      console.log(`  หยุด  ไม่พบไฟล์รายการ ${listPath}`);
      return { skipped: true, reason: 'LEGACY_LIST_NOT_FOUND', source: sourceLabel };
    }
    const list = await readFileList(listPath);
    diskFiles = list.files;
  } else {
    if (!(await directoryExists(String(legacyDir)))) {
      console.log(`  หยุด  ไม่พบโฟลเดอร์ ${legacyDir}`);
      return { skipped: true, reason: 'LEGACY_DIR_NOT_FOUND', source: sourceLabel };
    }
    diskFiles = await walkFiles(String(legacyDir));
  }

  console.log(`  ไฟล์ทั้งหมด: ${diskFiles.length}`);

  interface LegacyFile {
    relativePath: string;
    size: number;
    depth: number;
    folder: string;
    fileName: string;
    yearShort: string;
    yearBe: number;
    cid: string;
    fileNo: number;
  }

  const parsed: LegacyFile[] = [];
  const badName: unknown[][] = [];
  const notPdf: unknown[][] = [];

  for (const file of diskFiles) {
    const segments = file.relativePath.split('/');
    const fileName = segments[segments.length - 1];
    const folder = segments.slice(0, -1).join('/') || '(root)';

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      notPdf.push([file.relativePath, file.size]);
      continue;
    }

    const match = LEGACY_NAME_PATTERN.exec(fileName);
    if (!match) {
      badName.push([file.relativePath, file.size, 'ชื่อไม่เข้ารูปแบบ <ปี2หลัก>_<เลขบัตร13หลัก>[_<ลำดับ>].pdf']);
      continue;
    }

    parsed.push({
      relativePath: file.relativePath,
      size: file.size,
      depth: segments.length - 1,
      folder,
      fileName,
      yearShort: match[1],
      yearBe: 2500 + Number(match[1]),
      cid: match[2],
      fileNo: match[3] ? Number(match[3]) : 1
    });
  }

  console.log(`  ชื่อเข้ารูปแบบ: ${parsed.length} · ชื่อผิดรูปแบบ: ${badName.length} · ไม่ใช่ PDF: ${notPdf.length}`);

  const filesByYear = countBy(parsed, (file) => String(file.yearBe));
  const filesByFolder = countBy(parsed, (file) => file.folder);
  const filesByDepth = countBy(parsed, (file) => String(file.depth));

  console.log('\n  แยกตามปี พ.ศ. ที่อ่านได้จากชื่อไฟล์');
  for (const [year, count] of Object.entries(filesByYear).sort()) {
    console.log(`    ${year}: ${count}`);
  }

  console.log('\n  ความลึกของโฟลเดอร์ (0 = วางแบนในโฟลเดอร์หลัก)');
  for (const [depth, count] of Object.entries(filesByDepth).sort()) {
    console.log(`    ${depth} ชั้น: ${count}`);
  }

  const folderNames = Object.keys(filesByFolder);
  console.log(`\n  โฟลเดอร์ย่อยที่มีไฟล์: ${folderNames.length}`);
  for (const folder of folderNames.slice(0, options.sampleLimit).sort()) {
    console.log(`    ${folder}: ${filesByFolder[folder]}`);
  }
  if (folderNames.length > options.sampleLimit) {
    console.log(`    ... อีก ${folderNames.length - options.sampleLimit} โฟลเดอร์ ดูในไฟล์รายงาน`);
  }

  // โฟลเดอร์ที่ชื่อเป็นรหัสหน่วยงาน คือเบาะแสเดียวที่จะแมปไฟล์เข้าหน่วยงานได้
  const hospcodeLikeFolders = folderNames.filter((folder) => /(^|\/)\d{5}(\d{4})?$/.test(folder));
  console.log(
    `  โฟลเดอร์ที่ชื่อดูเป็นรหัสหน่วยงาน (5 หรือ 9 หลัก): ${hospcodeLikeFolders.length}` +
      (hospcodeLikeFolders.length ? '' : '  <-- ไม่มีเบาะแสหน่วยงานในโครงโฟลเดอร์')
  );

  // เทียบกับฐาน ใช้ (year_be, cid, file_no) ซึ่งเป็น unique key ของ tax_documents
  const existingKeys = new Set<string>();
  const yearsInLegacy = [...new Set(parsed.map((file) => file.yearBe))];
  if (yearsInLegacy.length) {
    const rows: { year_be: number; cid: string; file_no: number }[] = await systemDb('tax_documents')
      .select('year_be', 'cid', 'file_no')
      .where('is_active', 1)
      .whereIn('year_be', yearsInLegacy);
    for (const row of rows) existingKeys.add(`${row.year_be}|${row.cid}|${row.file_no}`);
  }
  console.log(`\n  แถวในฐานที่อยู่ในปีเดียวกับของเก่า: ${existingKeys.size}`);

  const alreadyInDb: unknown[][] = [];
  const notInDb: LegacyFile[] = [];
  for (const file of parsed) {
    if (existingKeys.has(`${file.yearBe}|${file.cid}|${file.fileNo}`)) {
      alreadyInDb.push([file.relativePath, file.yearBe, file.cid, file.fileNo]);
    } else {
      notInDb.push(file);
    }
  }

  // unique key เป็น (year_be, cid, file_no) ข้ามหน่วยงาน ถ้าของเก่ามีเลขบัตรซ้ำปีเดียวกัน
  // จะชนกันเองตอนนำเข้า ต้องรู้ก่อนไม่ใช่ไปเจอกลางทาง
  const keyCount = new Map<string, LegacyFile[]>();
  for (const file of parsed) {
    const key = `${file.yearBe}|${file.cid}|${file.fileNo}`;
    const list = keyCount.get(key) ?? [];
    list.push(file);
    keyCount.set(key, list);
  }
  const collidingKeys: unknown[][] = [];
  for (const [key, files] of keyCount.entries()) {
    if (files.length > 1) {
      collidingKeys.push([key, files.length, files.map((file) => file.relativePath).join(' ')]);
    }
  }

  printFinding('ไฟล์ที่มีอยู่ในฐานแล้ว (ไม่ต้องนำเข้า)', alreadyInDb, options.sampleLimit);
  printFinding(
    'ไฟล์ของเก่าที่ยังไม่มีในฐาน (คือส่วนที่หลังบ้านมองไม่เห็น)',
    notInDb.map((file) => [file.relativePath, file.yearBe, file.cid, file.fileNo, file.size]),
    options.sampleLimit
  );
  printFinding('ชื่อไฟล์ผิดรูปแบบ', badName, options.sampleLimit);
  printFinding('ไฟล์ที่ไม่ใช่ PDF', notPdf, options.sampleLimit);
  printFinding(
    'เลขบัตร+ปี+ลำดับ ซ้ำกันเองในของเก่า (จะชน unique key ตอนนำเข้า)',
    collidingKeys,
    options.sampleLimit
  );

  // uploadIndividual บังคับว่า PDF ต้องมีหน้าเดียว ถ้าของเก่าหลายหน้าจะนำเข้าไม่ได้
  const pageCounts: unknown[][] = [];
  let multiPage = 0;
  let unreadable = 0;
  if (options.pageCheckLimit > 0 && useList) {
    console.log('\n  ข้าม --check-pages เพราะอ่านจากรายการไฟล์ ไม่มีตัวไฟล์ให้เปิด');
  }
  if (options.pageCheckLimit > 0 && !useList && notInDb.length) {
    const { PDFDocument } = await import('pdf-lib');
    const step = Math.max(1, Math.floor(notInDb.length / options.pageCheckLimit));
    const sample: LegacyFile[] = [];
    for (let index = 0; index < notInDb.length && sample.length < options.pageCheckLimit; index += step) {
      sample.push(notInDb[index]);
    }

    console.log(`\n  สุ่มเปิด PDF ${sample.length} ไฟล์เพื่อนับหน้า`);
    for (const file of sample) {
      try {
        const buffer = await fs.readFile(path.join(String(legacyDir), file.relativePath));
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = pdf.getPageCount();
        if (pages !== 1) multiPage += 1;
        pageCounts.push([file.relativePath, pages, file.size]);
      } catch (error: any) {
        unreadable += 1;
        pageCounts.push([file.relativePath, 'อ่านไม่ได้', String(error?.message ?? error)]);
      }
    }
    console.log(`    หน้าเดียว ${sample.length - multiPage - unreadable} · หลายหน้า ${multiPage} · อ่านไม่ได้ ${unreadable}`);
    if (multiPage > 0) {
      console.log('    มีไฟล์หลายหน้า uploadIndividual จะปฏิเสธ ต้องตัดสินใจก่อนนำเข้า');
    }
  }

  await writeCsv(path.join(outDir, 'B-ยังไม่มีในฐาน.csv'), ['relative_path', 'year_be', 'cid', 'file_no', 'size'], notInDb.map((file) => [file.relativePath, file.yearBe, file.cid, file.fileNo, file.size]));
  await writeCsv(path.join(outDir, 'B-มีในฐานแล้ว.csv'), ['relative_path', 'year_be', 'cid', 'file_no'], alreadyInDb);
  await writeCsv(path.join(outDir, 'B-ชื่อผิดรูปแบบ.csv'), ['relative_path', 'size', 'reason'], badName);
  await writeCsv(path.join(outDir, 'B-ไม่ใช่-pdf.csv'), ['relative_path', 'size'], notPdf);
  await writeCsv(path.join(outDir, 'B-คีย์ซ้ำกันเอง.csv'), ['year_be|cid|file_no', 'count', 'files'], collidingKeys);
  await writeCsv(path.join(outDir, 'B-โฟลเดอร์.csv'), ['folder', 'file_count'], Object.entries(filesByFolder).map(([folder, count]) => [folder, count]));
  if (pageCounts.length) {
    await writeCsv(path.join(outDir, 'B-จำนวนหน้าตัวอย่าง.csv'), ['relative_path', 'pages', 'note'], pageCounts);
  }

  return {
    skipped: false,
    source: sourceLabel,
    fromFileList: useList,
    filesTotal: diskFiles.length,
    parsedOk: parsed.length,
    badName: badName.length,
    notPdf: notPdf.length,
    filesByYear,
    filesByDepth,
    folderCount: folderNames.length,
    hospcodeLikeFolderCount: hospcodeLikeFolders.length,
    alreadyInDb: alreadyInDb.length,
    notInDb: notInDb.length,
    collidingKeys: collidingKeys.length,
    pageSample: options.pageCheckLimit > 0 && !useList ? { checked: pageCounts.length, multiPage, unreadable } : null
  };
}

async function main() {
  const options = readOptions();
  await fs.mkdir(options.outDir, { recursive: true });

  console.log('ตรวจความตรงกันของข้อมูลใบรับรองภาษีกับไฟล์จริง — โหมดอ่านอย่างเดียว');
  console.log(`  รายงาน: ${options.outDir}`);

  const summary: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    readOnly: true,
    storage: null,
    legacy: null
  };

  if (options.storageDir || options.storageListPath) {
    summary.storage = await auditStorage(options, options.outDir);
  } else {
    printSection('ครึ่ง A — ข้ามตามที่สั่ง (--storage=off)');
  }

  if (options.legacyDir || options.legacyListPath) {
    summary.legacy = await auditLegacy(options, options.outDir);
  } else {
    printSection('ครึ่ง B — ข้าม เพราะไม่ได้ระบุ --legacy หรือ --legacy-list');
    console.log('  ใส่ --legacy=<โฟลเดอร์เดียวกับ TAX_PDF_PATH ของ mymoph-api> เพื่อตรวจของเก่า');
    console.log('  หรือ --legacy-list=<ไฟล์รายการจาก server> ถ้าวิเคราะห์จากอีกเครื่อง');
  }

  const summaryPath = path.join(options.outDir, 'สรุป.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  printSection('เสร็จแล้ว');
  console.log(`  สรุปตัวเลขทั้งหมด: ${summaryPath}`);
  console.log('  รายละเอียดแต่ละหัวข้อเป็นไฟล์ CSV ในโฟลเดอร์เดียวกัน');
}

main()
  .catch((error) => {
    console.error('\nสคริปต์ตรวจล้มเหลว');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await systemDb.destroy();
  });
