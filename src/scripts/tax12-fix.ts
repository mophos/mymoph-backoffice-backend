import path from 'path';
import fs from 'fs/promises';
import { systemDb } from '../db/knex';

/**
 * TAX-12 — เอกสาร 1,228 แถวของปีภาษี id=14 บันทึก year_be เป็น 2500
 * ทั้งที่ปีภาษีจริงคือ 2568 ทำให้ชื่อไฟล์ขึ้นต้น 00_ และเก็บอยู่ใน 00/00003/
 *
 * ต้นเหตุคือมีคนแก้ปีของ tax_years หลังอัปโหลดไปแล้ว ซึ่งไม่ย้อนไปแก้เอกสาร
 * ดู 03-ISSUE-REGISTER.md หัวข้อ TAX-12
 *
 * ลำดับที่ใช้คือ คัดลอก -> สลับค่าในฐาน -> ตรวจ -> ลบของเดิม
 * แยกการลบออกเป็นคำสั่งต่างหาก ของเดิมจึงอยู่ครบจนกว่าจะยืนยันว่าถูกต้อง
 * ไม่มีวินาทีใดที่แถวชี้ไปยังไฟล์ที่ไม่มีอยู่ แอปจึงไม่ได้รับผลกระทบ
 *
 * โหมด
 *   (ไม่ใส่อะไร)   ตรวจและพิมพ์แผน ไม่เขียนอะไรเลย
 *   --run          คัดลอกไฟล์ + อัปเดตฐาน (ยังไม่ลบของเดิม)
 *   --verify       ตรวจว่าแถวกับไฟล์ตรงกันหลัง --run
 *   --cleanup      ลบไฟล์เดิมใน 00/00003/ ทำหลัง --verify ผ่านแล้วเท่านั้น
 *   --rollback=<report.json>  คืนค่าทั้งสามคอลัมน์และลบไฟล์ที่คัดลอกไป
 */

const TAX_YEAR_ID = 14;
const OLD_YEAR_BE = 2500;

interface Row {
  id: string;
  cid: string;
  file_no: number;
  file_name: string;
  relative_path: string;
  year_be: number;
}

interface PlanItem {
  id: string;
  cid: string;
  oldYearBe: number;
  oldFileNo: number;
  oldFileName: string;
  oldPath: string;
  newYearBe: number;
  newFileNo: number;
  newFileName: string;
  newPath: string;
}

const usage = `
ใช้งาน
  npx tsx src/scripts/tax12-fix.ts [--storage=<dir>] [--report=<file>] [โหมด]

โหมด
  (ไม่ใส่)                  ตรวจและพิมพ์แผน ไม่เขียนอะไร
  --run                     คัดลอกไฟล์ + อัปเดตฐาน ยังไม่ลบของเดิม
  --verify                  ตรวจว่าแถวกับไฟล์ตรงกันหลัง --run
  --cleanup                 ลบไฟล์เดิม ทำหลัง --verify ผ่านแล้ว
  --rollback=<report.json>  ย้อนกลับทั้งหมด

ค่าเริ่มต้นของ --storage คือ <cwd>/storage/tax
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

const yearShort = (yearBe: number) => String(yearBe % 100).padStart(2, '0');
const buildFileName = (ys: string, cid: string, fileNo: number) => `${ys}_${cid}_${fileNo}.pdf`;
const buildRelativePath = (ys: string, hospcode: string, fileName: string) =>
  path.posix.join(ys, hospcode, fileName);

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function buildPlan(storageDir: string) {
  const year = await systemDb('tax_years').where({ id: TAX_YEAR_ID }).first();
  if (!year) throw new Error(`ไม่พบปีภาษี id=${TAX_YEAR_ID}`);
  if (Number(year.is_active) !== 1) throw new Error('ปีภาษีนี้ถูกปิดใช้งานแล้ว หยุดเพื่อความปลอดภัย');

  const newYearBe = Number(year.year_be);
  const hospcode = String(year.hospcode);
  const ys = yearShort(newYearBe);

  const rows: Row[] = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, year_be: OLD_YEAR_BE, is_active: 1 })
    .select('id', 'cid', 'file_no', 'file_name', 'relative_path', 'year_be');

  // file_no ที่ปีปลายทางใช้ไปแล้ว คีย์ unique คือ (year_be, cid, file_no) ไม่มี hospcode
  const taken = new Map<string, Set<number>>();
  const cids = [...new Set(rows.map((r) => String(r.cid)))];
  for (let i = 0; i < cids.length; i += 500) {
    const ex = await systemDb('tax_documents')
      .where('year_be', newYearBe)
      .whereIn('cid', cids.slice(i, i + 500))
      .select('cid', 'file_no');
    for (const r of ex as any[]) {
      const s = taken.get(String(r.cid)) ?? new Set<number>();
      s.add(Number(r.file_no));
      taken.set(String(r.cid), s);
    }
  }

  const plan: PlanItem[] = [];
  const seen = new Map<string, Set<number>>();   // กันชนกันเองภายในแผน
  for (const r of rows) {
    const cid = String(r.cid);
    const used = new Set<number>([...(taken.get(cid) ?? []), ...(seen.get(cid) ?? [])]);
    let fileNo = Number(r.file_no);
    if (used.has(fileNo)) { fileNo = 1; while (used.has(fileNo)) fileNo += 1; }
    const s = seen.get(cid) ?? new Set<number>(); s.add(fileNo); seen.set(cid, s);

    const newFileName = buildFileName(ys, cid, fileNo);
    plan.push({
      id: String(r.id), cid,
      oldYearBe: Number(r.year_be), oldFileNo: Number(r.file_no),
      oldFileName: String(r.file_name), oldPath: String(r.relative_path).replace(/\\/g, '/'),
      newYearBe, newFileNo: fileNo, newFileName,
      newPath: buildRelativePath(ys, hospcode, newFileName)
    });
  }

  return { year: { id: TAX_YEAR_ID, yearBe: newYearBe, hospcode }, plan, storageDir };
}

async function precheck(storageDir: string, plan: PlanItem[]) {
  const missingSource: string[] = [];
  const targetExists: string[] = [];
  const dupTarget: string[] = [];
  const seenTarget = new Set<string>();

  for (const it of plan) {
    if (!(await exists(path.resolve(storageDir, it.oldPath)))) missingSource.push(it.oldPath);
    if (await exists(path.resolve(storageDir, it.newPath))) targetExists.push(it.newPath);
    if (seenTarget.has(it.newPath)) dupTarget.push(it.newPath);
    seenTarget.add(it.newPath);
  }
  return { missingSource, targetExists, dupTarget };
}

function printPlan(info: Awaited<ReturnType<typeof buildPlan>>) {
  const { plan, year } = info;
  console.log(`ปีภาษี id=${year.id} · ปี ${year.yearBe} · หน่วยงาน ${year.hospcode}`);
  console.log(`แถวที่จะแก้: ${plan.length}`);
  const keep = plan.filter((p) => p.newFileNo === p.oldFileNo).length;
  console.log(`  คง file_no เดิม: ${keep}`);
  console.log(`  เปลี่ยน file_no: ${plan.length - keep}`);
  for (const p of plan.filter((x) => x.newFileNo !== x.oldFileNo)) {
    console.log(`     id=${p.id}  file_no ${p.oldFileNo} -> ${p.newFileNo}`);
  }
  const sample = plan[0];
  if (sample) {
    console.log('\nตัวอย่างการเปลี่ยน (ปิดเลขบัตร)');
    const m = (s: string) => s.replace(/\d{13}/g, '<เลขบัตร>');
    console.log(`  year_be       ${sample.oldYearBe} -> ${sample.newYearBe}`);
    console.log(`  file_name     ${m(sample.oldFileName)} -> ${m(sample.newFileName)}`);
    console.log(`  relative_path ${m(sample.oldPath)} -> ${m(sample.newPath)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }

  const storageDir = path.resolve(
    typeof args.storage === 'string' ? args.storage : path.join(process.cwd(), 'storage', 'tax')
  );
  const reportPath = path.resolve(
    typeof args.report === 'string' ? args.report : path.join(process.cwd(), `tax12-report-${Date.now()}.json`)
  );

  if (typeof args.rollback === 'string') return rollback(args.rollback, storageDir);
  if (args.verify) return verify(storageDir);
  if (args.cleanup) return cleanup(storageDir);

  if (!(await exists(storageDir))) throw new Error(`ไม่พบโฟลเดอร์ ${storageDir}`);

  const info = await buildPlan(storageDir);
  console.log(`โฟลเดอร์ไฟล์: ${storageDir}\n`);
  printPlan(info);

  console.log('\n=== ตรวจก่อนลงมือ ===');
  const chk = await precheck(storageDir, info.plan);
  console.log(`  ไฟล์ต้นทางที่ไม่พบ      : ${chk.missingSource.length}`);
  console.log(`  ไฟล์ปลายทางที่มีอยู่แล้ว : ${chk.targetExists.length}`);
  console.log(`  ปลายทางซ้ำกันเองในแผน  : ${chk.dupTarget.length}`);
  const blocked = chk.missingSource.length || chk.targetExists.length || chk.dupTarget.length;
  if (blocked) {
    for (const p of [...chk.missingSource, ...chk.targetExists, ...chk.dupTarget].slice(0, 5)) {
      console.log(`     ${p.replace(/\d{13}/g, '<เลขบัตร>')}`);   // ไม่พิมพ์เลขบัตรจริงลง log
    }
    throw new Error('ตรวจไม่ผ่าน หยุดโดยไม่แตะอะไร');
  }
  console.log('  ผ่านทั้งหมด');

  if (!args.run) {
    console.log('\nโหมดตรวจอย่างเดียว ยังไม่เขียนอะไร ใส่ --run เพื่อทำจริง');
    return;
  }

  console.log('\n=== เริ่มทำจริง ===');
  const doneItems: PlanItem[] = [];
  let copied = 0, updated = 0;
  try {
    for (const it of info.plan) {
      const src = path.resolve(storageDir, it.oldPath);
      const dst = path.resolve(storageDir, it.newPath);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      copied += 1;

      const n = await systemDb('tax_documents')
        .where({ id: it.id, year_be: it.oldYearBe })
        .update({ year_be: it.newYearBe, file_no: it.newFileNo, file_name: it.newFileName, relative_path: it.newPath });
      if (Number(n) !== 1) {
        await fs.rm(dst, { force: true });
        throw new Error(`อัปเดตแถว id=${it.id} ได้ ${n} แถว (ต้องเป็น 1) หยุดทันที`);
      }
      updated += 1;
      doneItems.push(it);
      if (doneItems.length % 200 === 0) console.log(`  ...${doneItems.length}/${info.plan.length}`);
    }
  } finally {
    await fs.writeFile(reportPath, JSON.stringify({
      ranAt: new Date().toISOString(), storageDir, year: info.year,
      copied, updated, items: doneItems
    }, null, 1), 'utf8');
    console.log(`\nรายงาน: ${reportPath}`);
  }

  console.log(`คัดลอกไฟล์ ${copied} · อัปเดตแถว ${updated} จากทั้งหมด ${info.plan.length}`);
  console.log('ไฟล์เดิมใน 00/00003/ ยังอยู่ครบ ยังไม่ลบ');
  console.log('ขั้นต่อไป: รันด้วย --verify');
}

async function verify(storageDir: string) {
  console.log('=== ตรวจความถูกต้องหลังแก้ ===');
  const left = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, year_be: OLD_YEAR_BE }).count('* as n');
  console.log(`แถวที่ยังเป็น year_be=${OLD_YEAR_BE}: ${(left as any)[0].n}  (ต้องเป็น 0)`);

  const rows = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, is_active: 1 })
    .select('id', 'cid', 'year_be', 'file_no', 'file_name', 'relative_path');
  const year = await systemDb('tax_years').where({ id: TAX_YEAR_ID }).first();
  const ys = yearShort(Number(year.year_be));

  let badPath = 0, missingFile = 0, badName = 0;
  for (const r of rows as any[]) {
    const want = buildRelativePath(ys, String(year.hospcode), buildFileName(ys, String(r.cid), Number(r.file_no)));
    if (String(r.relative_path) !== want) badPath += 1;
    if (String(r.file_name) !== buildFileName(ys, String(r.cid), Number(r.file_no))) badName += 1;
    if (!(await exists(path.resolve(storageDir, String(r.relative_path))))) missingFile += 1;
  }
  console.log(`เอกสารใต้ปีนี้ทั้งหมด        : ${rows.length}`);
  console.log(`  relative_path ไม่ตรงสูตร  : ${badPath}  (ต้องเป็น 0)`);
  console.log(`  file_name ไม่ตรงสูตร      : ${badName}  (ต้องเป็น 0)`);
  console.log(`  ไฟล์หายบนดิสก์            : ${missingFile}  (ต้องเป็น 0)`);

  const ok = Number((left as any)[0].n) === 0 && !badPath && !badName && !missingFile;
  console.log(ok ? '\nผ่านทุกข้อ · ลบไฟล์เดิมได้ด้วย --cleanup' : '\nไม่ผ่าน · อย่าเพิ่ง --cleanup');
  if (!ok) process.exitCode = 4;
}

async function cleanup(storageDir: string) {
  const oldDir = path.resolve(storageDir, yearShort(OLD_YEAR_BE));
  console.log(`=== ลบไฟล์เดิมใต้ ${oldDir} ===`);
  const still = await systemDb('tax_documents')
    .where('relative_path', 'like', `${yearShort(OLD_YEAR_BE)}/%`).count('* as n');
  const n = Number((still as any)[0].n);
  console.log(`แถวที่ยังชี้ไปโฟลเดอร์นั้น: ${n}`);
  if (n > 0) throw new Error('ยังมีแถวอ้างถึงอยู่ หยุด');
  if (!(await exists(oldDir))) { console.log('ไม่มีโฟลเดอร์นี้แล้ว'); return; }
  const before = await fs.readdir(oldDir, { recursive: true } as any);
  console.log(`จะลบ ${(before as string[]).length} รายการ`);
  await fs.rm(oldDir, { recursive: true, force: true });
  console.log('ลบแล้ว');
}

async function rollback(reportFile: string, storageDir: string) {
  const report = JSON.parse(await fs.readFile(path.resolve(reportFile), 'utf8'));
  const items: PlanItem[] = report.items ?? [];
  console.log(`=== ย้อนกลับ ${items.length} แถว จาก ${reportFile} ===`);
  let n = 0;
  for (const it of items) {
    const back = await systemDb('tax_documents')
      .where({ id: it.id })
      .update({ year_be: it.oldYearBe, file_no: it.oldFileNo, file_name: it.oldFileName, relative_path: it.oldPath });
    if (Number(back) === 1) {
      await fs.rm(path.resolve(storageDir, it.newPath), { force: true });
      n += 1;
    }
  }
  console.log(`คืนค่าแล้ว ${n} แถว และลบไฟล์ที่คัดลอกไป`);
  console.log('ไฟล์เดิมไม่เคยถูกลบ จึงยังอยู่ครบ');
}

main()
  .catch((e) => { console.error('\nล้มเหลว:', e?.message ?? e); process.exitCode = 1; })
  .finally(async () => { await systemDb.destroy(); });
