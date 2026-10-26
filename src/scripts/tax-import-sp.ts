import path from 'path';
import fs from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { systemDb } from '../db/knex';
import { TaxModel } from '../modules/tax/tax.model';
import { TaxService } from '../modules/tax/tax.service';
import type { AuthContext } from '../shared/types/auth';

/**
 * นำเข้าใบรับรองภาษีของเก่าปี 2566 และ 2567 เข้าระบบ
 *
 * ไฟล์เดิมอยู่ในโฟลเดอร์ที่ mymoph-api อ่านตรง (TAX_PDF_PATH) ซึ่งหลังบ้านมองไม่เห็น
 * ชื่อไฟล์เป็น <ปี2หลัก>_<เลขบัตร>.pdf ไม่มีรหัสหน่วยงาน
 *
 * อ่านจากตัวเอกสารแล้วพบว่าผู้มีหน้าที่หักภาษีคือ **สำนักงานปลัดกระทรวงสาธารณสุข**
 * ตรงกันทั้ง 3,990 ไฟล์ที่แกะข้อความได้ จึงนำเข้าเป็นของหน่วยงาน 14165
 * ดู 18-TAX-FILE-RECONCILE.md
 *
 * ไม่เขียน insert เอง แต่เรียก TaxService.uploadIndividual ซึ่งมีการตรวจครบอยู่แล้ว
 * ไฟล์ที่มี 2 หน้าจะถูกแตะเป็นหน้าละไฟล์ก่อนป้อนเข้าไป ได้ file_no 1 และ 2 ตามลำดับ
 * แอปรวมเอกสารของเลขบัตร+ปีเดียวกันเรียงตาม file_no อยู่แล้ว ผู้ใช้จึงได้ไฟล์เหมือนเดิม
 *
 * โหมด
 *   (ไม่ใส่)      ตรวจและพิมพ์แผน ไม่เขียนอะไร
 *   --run         นำเข้าจริง
 *   --verify      ตรวจผลหลังนำเข้า
 *   --rollback    ลบทุกแถวของสองปีนี้และลบโฟลเดอร์ไฟล์ (ปีนี้เป็นของใหม่ทั้งหมด)
 */

const HOSPCODE_DEFAULT = '14165';
const YEARS = [2566, 2567] as const;
const NAME_RE = /^(\d{2})_(\d{13})\.pdf$/i;

const usage = `
ใช้งาน
  npx tsx src/scripts/tax-import-sp.ts --source=<dir> --actor=<user uuid> [โหมด]

  --source=<dir>     โฟลเดอร์ที่มีโฟลเดอร์ย่อย 66/ และ 67/
  --actor=<uuid>     id ของผู้ใช้ที่จะบันทึกเป็นผู้สร้าง หาได้จาก
                     SELECT id FROM users WHERE cid = '<เลขบัตรของคุณ>';
  --hospcode=<code>  ค่าเริ่มต้น ${HOSPCODE_DEFAULT}
  --storage=<dir>    ค่าเริ่มต้น <cwd>/storage/tax
  --chunk=<n>        จำนวนไฟล์ต่อหนึ่งคำสั่งนำเข้า ค่าเริ่มต้น 25
  --limit=<n>        จำกัดจำนวนไฟล์ ใช้ทดลองกับชุดเล็กก่อน

โหมด: --run · --verify · --rollback
`;

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const raw = item.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) out[raw.slice(0, eq)] = raw.slice(eq + 1);
    else out[raw] = true;
  }
  return out;
}

interface SourceFile {
  yearShort: string;
  yearBe: number;
  cid: string;
  abs: string;
  name: string;
}

function buildAuth(actorUserId: string): AuthContext {
  return {
    userId: actorUserId,
    cid: '',
    roles: ['super_admin'],
    permissions: ['payroll.read', 'payroll.export'],
    hospcodes: [],
    scopeType: 'ALL',
    displayName: 'นำเข้าใบรับรองภาษีของเก่า สป.สธ.'
  } as AuthContext;
}

async function scanSource(sourceDir: string, limit?: number): Promise<{ files: SourceFile[]; bad: string[] }> {
  const files: SourceFile[] = [];
  const bad: string[] = [];
  for (const yearShort of ['66', '67']) {
    const dir = path.join(sourceDir, yearShort);
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const name of entries.sort()) {
      const m = NAME_RE.exec(name);
      if (!m) { bad.push(`${yearShort}/${name}`); continue; }
      if (m[1] !== yearShort) { bad.push(`${yearShort}/${name} (ปีในชื่อไม่ตรงโฟลเดอร์)`); continue; }
      files.push({ yearShort, yearBe: 2500 + Number(m[1]), cid: m[2], abs: path.join(dir, name), name });
    }
  }
  files.sort((a, b) => (a.yearShort + a.cid).localeCompare(b.yearShort + b.cid));
  return { files: limit ? files.slice(0, limit) : files, bad };
}

async function pageCount(abs: string): Promise<number> {
  const pdf = await PDFDocument.load(await fs.readFile(abs), { ignoreEncryption: true });
  return pdf.getPageCount();
}

/** แตก PDF เป็นหน้าละไฟล์ ถ้ามีหน้าเดียวก็คืนไฟล์เดิมโดยไม่ประกอบใหม่ */
async function splitPages(abs: string): Promise<Buffer[]> {
  const raw = await fs.readFile(abs);
  const src = await PDFDocument.load(raw, { ignoreEncryption: true });
  const n = src.getPageCount();
  if (n === 1) return [raw];
  const out: Buffer[] = [];
  for (let i = 0; i < n; i += 1) {
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(src, [i]);
    one.addPage(p);
    out.push(Buffer.from(await one.save()));
  }
  return out;
}

async function findYears(hospcode: string) {
  const rows = await systemDb('tax_years').where('hospcode', hospcode).whereIn('year_be', YEARS as any)
    .select('id', 'year_be', 'is_active');
  const map = new Map<number, { id: number; active: boolean }>();
  for (const r of rows as any[]) map.set(Number(r.year_be), { id: Number(r.id), active: Number(r.is_active) === 1 });
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }

  const hospcode = typeof args.hospcode === 'string' ? args.hospcode : HOSPCODE_DEFAULT;
  const storageDir = path.resolve(typeof args.storage === 'string' ? args.storage : path.join(process.cwd(), 'storage', 'tax'));
  const chunkSize = Number(args.chunk) > 0 ? Math.floor(Number(args.chunk)) : 25;
  const limit = Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : undefined;

  if (args.rollback) return rollback(hospcode, storageDir);
  if (args.verify) return verify(hospcode, storageDir);

  const sourceDir = typeof args.source === 'string' ? path.resolve(args.source) : '';
  if (!sourceDir) { console.log(usage); throw new Error('ต้องระบุ --source'); }

  const years = await findYears(hospcode);
  console.log(`หน่วยงาน ${hospcode} · โฟลเดอร์ไฟล์ ${storageDir}`);
  console.log('ปีภาษีที่ต้องมีอยู่ก่อน');
  let missingYear = false;
  for (const y of YEARS) {
    const info = years.get(y);
    console.log(`  ${y}: ${info ? `id=${info.id} ${info.active ? 'ใช้งานอยู่' : 'ถูกปิด'}` : 'ยังไม่มี'}`);
    if (!info || !info.active) missingYear = true;
  }
  if (missingYear) throw new Error(`ต้องสร้างปีภาษี ${YEARS.join(' และ ')} ของหน่วยงาน ${hospcode} ในหน้าเว็บก่อน`);

  const { files, bad } = await scanSource(sourceDir, limit);
  console.log(`\nไฟล์ต้นทาง: ${files.length}${limit ? ` (จำกัดไว้ที่ ${limit})` : ''} · ชื่อผิดรูปแบบ: ${bad.length}`);
  if (bad.length) for (const b of bad.slice(0, 5)) console.log(`   ${b.replace(/\d{13}/g, '<เลขบัตร>')}`);
  if (!files.length) throw new Error('ไม่พบไฟล์ต้นทาง');

  console.log('\n=== ตรวจก่อนลงมือ ===');
  // 1) นับหน้าทุกไฟล์
  const pages = new Map<string, number>();
  let unreadable = 0;
  for (let i = 0; i < files.length; i += 1) {
    try { pages.set(files[i].abs, await pageCount(files[i].abs)); }
    catch { unreadable += 1; }
    if ((i + 1) % 1000 === 0) process.stderr.write(`  นับหน้า ${i + 1}/${files.length}\n`);
  }
  const dist = new Map<number, number>();
  for (const n of pages.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  console.log(`  จำนวนหน้า: ${[...dist].sort().map(([k, v]) => `${k} หน้า = ${v} ไฟล์`).join(' · ')}`);
  console.log(`  อ่านไม่ได้: ${unreadable}`);
  if (unreadable) throw new Error('มีไฟล์ที่เปิดไม่ได้ หยุดก่อน');

  const expectedDocs = [...pages.values()].reduce((a, b) => a + b, 0);
  console.log(`  จะได้เอกสารทั้งหมด: ${expectedDocs}`);

  // 2) ต้องไม่มีแถวเดิมของเลขบัตรเหล่านี้ในสองปีนั้น
  let existing = 0;
  for (const y of YEARS) {
    const cids = files.filter((f) => f.yearBe === y).map((f) => f.cid);
    for (let i = 0; i < cids.length; i += 500) {
      const hit = await systemDb('tax_documents').where('year_be', y)
        .whereIn('cid', cids.slice(i, i + 500)).count('* as n');
      existing += Number((hit as any)[0].n);
    }
  }
  console.log(`  แถวเดิมในปี ${YEARS.join('/')} ของเลขบัตรเหล่านี้: ${existing}  (ต้องเป็น 0)`);

  // 3) ไฟล์ปลายทางต้องยังไม่มี
  let targetExists = 0;
  for (const f of files) {
    const p = path.resolve(storageDir, f.yearShort, hospcode, `${f.yearShort}_${f.cid}_1.pdf`);
    try { await fs.access(p); targetExists += 1; } catch { /* ไม่มี = ดี */ }
  }
  console.log(`  ไฟล์ปลายทางที่มีอยู่แล้ว: ${targetExists}  (ต้องเป็น 0)`);

  // 4) เลขบัตรซ้ำกันเองในปีเดียวกัน
  let selfDup = 0;
  for (const y of YEARS) {
    const seen = new Set<string>();
    for (const f of files.filter((x) => x.yearBe === y)) { if (seen.has(f.cid)) selfDup += 1; seen.add(f.cid); }
  }
  console.log(`  เลขบัตรซ้ำกันเองในปีเดียวกัน: ${selfDup}  (ต้องเป็น 0)`);

  if (existing || targetExists || selfDup) throw new Error('ตรวจไม่ผ่าน หยุดโดยไม่แตะอะไร');
  console.log('  ผ่านทั้งหมด');

  if (!args.run) {
    console.log('\nโหมดตรวจอย่างเดียว ยังไม่เขียนอะไร ใส่ --run เพื่อทำจริง');
    return;
  }

  const actor = typeof args.actor === 'string' ? args.actor.trim() : '';
  if (!actor) throw new Error('ต้องระบุ --actor=<user uuid> เพื่อบันทึกว่าใครเป็นผู้นำเข้า');

  const service = new TaxService(new TaxModel(systemDb));
  const auth = buildAuth(actor);

  console.log('\n=== เริ่มนำเข้า ===');
  let created = 0, filesDone = 0;
  const failures: string[] = [];

  for (const y of YEARS) {
    const yearId = years.get(y)!.id;
    const list = files.filter((f) => f.yearBe === y);
    console.log(`\nปี ${y} (id=${yearId}) · ${list.length} ไฟล์`);

    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const items: { cid: string; buffer: Buffer; originalName: string }[] = [];
      for (const f of chunk) {
        for (const buf of await splitPages(f.abs)) {
          items.push({ cid: f.cid, buffer: buf, originalName: f.name });
        }
      }
      const res: any = await service.uploadIndividual(auth, yearId, items as any);
      if (!res?.ok) {
        failures.push(`ชุดที่เริ่มด้วยไฟล์ลำดับ ${i}: ${res?.error ?? 'ไม่ทราบสาเหตุ'}`);
        throw new Error(`นำเข้าล้มเหลว: ${res?.error ?? 'ไม่ทราบสาเหตุ'} — หยุดทันที`);
      }
      created += Number(res.data?.createdCount ?? 0);
      filesDone += chunk.length;
      if (filesDone % 500 < chunkSize) console.log(`  ...${filesDone}/${list.length} ไฟล์ · ${created} เอกสาร`);
    }
  }

  console.log(`\nนำเข้าแล้ว ${filesDone} ไฟล์ -> ${created} เอกสาร (คาดไว้ ${expectedDocs})`);
  if (failures.length) for (const f of failures) console.log(`  ${f}`);
  console.log('ขั้นต่อไป: --verify');
}

async function verify(hospcode: string, storageDir: string) {
  console.log('=== ตรวจผลหลังนำเข้า ===');
  const years = await findYears(hospcode);
  const ys = (y: number) => String(y % 100).padStart(2, '0');
  let bad = 0, missing = 0, total = 0;

  for (const y of YEARS) {
    const info = years.get(y);
    if (!info) { console.log(`  ปี ${y}: ไม่มีปีภาษี`); continue; }
    const rows = await systemDb('tax_documents')
      .where({ tax_year_id: info.id, is_active: 1 })
      .select('cid', 'file_no', 'file_name', 'relative_path', 'year_be', 'hospcode');
    total += rows.length;
    let b = 0, m = 0;
    for (const r of rows as any[]) {
      const wantName = `${ys(y)}_${r.cid}_${r.file_no}.pdf`;
      const wantPath = path.posix.join(ys(y), hospcode, wantName);
      if (String(r.file_name) !== wantName || String(r.relative_path) !== wantPath
          || Number(r.year_be) !== y || String(r.hospcode) !== hospcode) b += 1;
      try { await fs.access(path.resolve(storageDir, String(r.relative_path))); } catch { m += 1; }
    }
    bad += b; missing += m;
    const people = new Set((rows as any[]).map((r) => String(r.cid))).size;
    console.log(`  ปี ${y} (id=${info.id}): ${rows.length} เอกสาร · ${people} คน · ผิดสูตร ${b} · ไฟล์หาย ${m}`);
  }
  console.log(`\nรวม ${total} เอกสาร · ผิดสูตร ${bad} · ไฟล์หาย ${missing}`);
  const ok = !bad && !missing;
  console.log(ok ? 'ผ่านทุกข้อ' : 'ไม่ผ่าน');
  if (!ok) process.exitCode = 4;
}

async function rollback(hospcode: string, storageDir: string) {
  const years = await findYears(hospcode);
  console.log('=== ย้อนกลับ ลบทุกแถวของสองปีนี้ ===');
  console.log('ปลอดภัยเพราะสองปีนี้ไม่เคยมีข้อมูลมาก่อนการนำเข้า');
  for (const y of YEARS) {
    const info = years.get(y);
    if (!info) continue;
    const n = await systemDb('tax_documents').where('tax_year_id', info.id).delete();
    console.log(`  ปี ${y}: ลบ ${n} แถว`);
    const dir = path.resolve(storageDir, String(y % 100).padStart(2, '0'), hospcode);
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`  ลบโฟลเดอร์ ${dir}`);
  }
  console.log('ปีภาษีทั้งสองยังอยู่ ลบเองได้จากหน้าเว็บถ้าต้องการ');
}

main()
  .catch((e) => { console.error('\nล้มเหลว:', e?.message ?? e); process.exitCode = 1; })
  .finally(async () => { await systemDb.destroy(); });
