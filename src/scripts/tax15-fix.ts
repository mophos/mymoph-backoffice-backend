import path from 'path';
import fs from 'fs/promises';
import { systemDb } from '../db/knex';

/**
 * TAX-15 — เอกสาร 1,031 แถวของปีภาษี id=29 (หน่วยงาน 10700 โรงพยาบาลศรีสะเกษ)
 * ถูกเก็บไว้ใน 68/10699/ ซึ่งเป็นโฟลเดอร์ของโรงพยาบาลสมเด็จพระยุพราชสระแก้ว
 *
 * ต้นเหตุคือมีคนอัปโหลดเข้า 10699 ก่อน แล้วย้ายแถวไป 10700 ด้วย SQL ตรง
 * โดยไม่ได้แก้ relative_path และไม่ได้ย้ายไฟล์ ดู TAX-15 ใน 03-ISSUE-REGISTER.md
 *
 * ยืนยันว่าฐานถูกและไฟล์อยู่ผิดที่ จากการเทียบรหัสจังหวัดในเลขบัตร
 * กลุ่มนี้เป็นคนศรีสะเกษ 73% ขณะที่กลุ่มของ 10699 ที่ถูกต้องเป็นคนปราจีนบุรี/สระแก้ว 69%
 *
 * **สำคัญ** 68/10699/ ยังมีไฟล์ของปีภาษี id=28 อีก 606 ไฟล์ที่ถูกต้องอยู่
 * การลบของเดิมจึงลบเฉพาะไฟล์ในรายการเท่านั้น ห้ามลบทั้งโฟลเดอร์
 *
 * เปลี่ยนแค่ relative_path · year_be, hospcode, file_no, file_name ไม่แตะ
 */

const TAX_YEAR_ID = 29;
const WRONG_PREFIX = '68/10699/';

interface PlanItem {
  id: string;
  oldPath: string;
  newPath: string;
}

const usage = `
ใช้งาน
  npx tsx src/scripts/tax15-fix.ts [--storage=<dir>] [--report=<file>] [โหมด]

โหมด
  (ไม่ใส่)                  ตรวจและพิมพ์แผน ไม่เขียนอะไร
  --run                     คัดลอกไฟล์ + อัปเดต relative_path ยังไม่ลบของเดิม
  --verify                  ตรวจว่าแถวกับไฟล์ตรงกันหลัง --run
  --cleanup=<report.json>   ลบเฉพาะไฟล์เดิมที่อยู่ในรายงาน หลัง --verify ผ่านแล้ว
  --rollback=<report.json>  ย้อนกลับ
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

const yearShort = (y: number) => String(y % 100).padStart(2, '0');
async function exists(p: string) { try { await fs.access(p); return true; } catch { return false; } }

async function buildPlan() {
  const year = await systemDb('tax_years').where({ id: TAX_YEAR_ID }).first();
  if (!year) throw new Error(`ไม่พบปีภาษี id=${TAX_YEAR_ID}`);
  if (Number(year.is_active) !== 1) throw new Error('ปีภาษีนี้ถูกปิดใช้งานแล้ว หยุด');

  const ys = yearShort(Number(year.year_be));
  const hospcode = String(year.hospcode);

  const rows = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, is_active: 1 })
    .where('relative_path', 'like', `${WRONG_PREFIX}%`)
    .select('id', 'cid', 'hospcode', 'file_no', 'file_name', 'relative_path');

  const plan: PlanItem[] = rows.map((r: any) => ({
    id: String(r.id),
    oldPath: String(r.relative_path).replace(/\\/g, '/'),
    newPath: path.posix.join(ys, hospcode, String(r.file_name))
  }));

  // แถวพวกนี้ต้องมี hospcode ตรงกับปีอยู่แล้ว ถ้าไม่ใช่แปลว่าเข้าใจผิดบางอย่าง
  const badHosp = (rows as any[]).filter((r) => String(r.hospcode) !== hospcode);
  if (badHosp.length) throw new Error(`มี ${badHosp.length} แถวที่ hospcode ไม่ตรงกับปี หยุดเพื่อตรวจก่อน`);

  return { year: { id: TAX_YEAR_ID, yearBe: Number(year.year_be), hospcode }, plan };
}

async function precheck(storageDir: string, plan: PlanItem[]) {
  const missingSource: string[] = [];
  const targetExists: string[] = [];
  const dupTarget: string[] = [];
  const seen = new Set<string>();
  for (const it of plan) {
    if (!(await exists(path.resolve(storageDir, it.oldPath)))) missingSource.push(it.oldPath);
    if (await exists(path.resolve(storageDir, it.newPath))) targetExists.push(it.newPath);
    if (seen.has(it.newPath)) dupTarget.push(it.newPath);
    seen.add(it.newPath);
  }
  // ไฟล์ของปีอื่นที่อยู่ในโฟลเดอร์เดียวกัน ต้องไม่ถูกแตะ
  const others = await systemDb('tax_documents')
    .where('is_active', 1)
    .where('relative_path', 'like', `${WRONG_PREFIX}%`)
    .whereNot('tax_year_id', TAX_YEAR_ID)
    .count('* as n');
  return { missingSource, targetExists, dupTarget, otherYearInFolder: Number((others as any)[0].n) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }

  const storageDir = path.resolve(
    typeof args.storage === 'string' ? args.storage : path.join(process.cwd(), 'storage', 'tax')
  );
  const reportPath = path.resolve(
    typeof args.report === 'string' ? args.report : path.join(process.cwd(), `tax15-report-${Date.now()}.json`)
  );

  if (typeof args.rollback === 'string') return rollback(args.rollback, storageDir);
  if (typeof args.cleanup === 'string') return cleanup(args.cleanup, storageDir);
  if (args.verify) return verify(storageDir);

  if (!(await exists(storageDir))) throw new Error(`ไม่พบโฟลเดอร์ ${storageDir}`);

  const { year, plan } = await buildPlan();
  console.log(`โฟลเดอร์ไฟล์: ${storageDir}\n`);
  console.log(`ปีภาษี id=${year.id} · ปี ${year.yearBe} · หน่วยงาน ${year.hospcode}`);
  console.log(`แถวที่จะย้าย: ${plan.length}`);
  if (plan[0]) {
    const m = (s: string) => s.replace(/\d{13}/g, '<เลขบัตร>');
    console.log(`\nตัวอย่าง (ปิดเลขบัตร)`);
    console.log(`  relative_path ${m(plan[0].oldPath)} -> ${m(plan[0].newPath)}`);
    console.log(`  year_be, hospcode, file_no, file_name  ไม่เปลี่ยน`);
  }

  console.log('\n=== ตรวจก่อนลงมือ ===');
  const chk = await precheck(storageDir, plan);
  console.log(`  ไฟล์ต้นทางที่ไม่พบ            : ${chk.missingSource.length}`);
  console.log(`  ไฟล์ปลายทางที่มีอยู่แล้ว       : ${chk.targetExists.length}`);
  console.log(`  ปลายทางซ้ำกันเองในแผน        : ${chk.dupTarget.length}`);
  console.log(`  ไฟล์ของปีอื่นใน ${WRONG_PREFIX} : ${chk.otherYearInFolder}  (ห้ามแตะ จะเหลือไว้)`);
  if (chk.missingSource.length || chk.targetExists.length || chk.dupTarget.length) {
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
  const done: PlanItem[] = [];
  let copied = 0, updated = 0;
  try {
    for (const it of plan) {
      const src = path.resolve(storageDir, it.oldPath);
      const dst = path.resolve(storageDir, it.newPath);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      copied += 1;

      const n = await systemDb('tax_documents')
        .where({ id: it.id, relative_path: it.oldPath })
        .update({ relative_path: it.newPath });
      if (Number(n) !== 1) {
        await fs.rm(dst, { force: true });
        throw new Error(`อัปเดตแถว id=${it.id} ได้ ${n} แถว (ต้องเป็น 1) หยุดทันที`);
      }
      updated += 1;
      done.push(it);
      if (done.length % 200 === 0) console.log(`  ...${done.length}/${plan.length}`);
    }
  } finally {
    await fs.writeFile(reportPath, JSON.stringify({
      ranAt: new Date().toISOString(), storageDir, year, copied, updated, items: done
    }, null, 1), 'utf8');
    console.log(`\nรายงาน: ${reportPath}`);
  }

  console.log(`คัดลอกไฟล์ ${copied} · อัปเดตแถว ${updated} จากทั้งหมด ${plan.length}`);
  console.log(`ไฟล์เดิมใน ${WRONG_PREFIX} ยังอยู่ครบ ยังไม่ลบ`);
  console.log('ขั้นต่อไป: รันด้วย --verify');
}

async function verify(storageDir: string) {
  console.log('=== ตรวจความถูกต้องหลังย้าย ===');
  const left = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, is_active: 1 })
    .where('relative_path', 'like', `${WRONG_PREFIX}%`).count('* as n');
  console.log(`แถวของปี ${TAX_YEAR_ID} ที่ยังชี้ ${WRONG_PREFIX}: ${(left as any)[0].n}  (ต้องเป็น 0)`);

  const year = await systemDb('tax_years').where({ id: TAX_YEAR_ID }).first();
  const ys = yearShort(Number(year.year_be));
  const rows = await systemDb('tax_documents')
    .where({ tax_year_id: TAX_YEAR_ID, is_active: 1 })
    .select('relative_path', 'file_name');
  let badPath = 0, missing = 0;
  for (const r of rows as any[]) {
    const want = path.posix.join(ys, String(year.hospcode), String(r.file_name));
    if (String(r.relative_path) !== want) badPath += 1;
    if (!(await exists(path.resolve(storageDir, String(r.relative_path))))) missing += 1;
  }
  console.log(`เอกสารใต้ปีนี้ทั้งหมด      : ${rows.length}`);
  console.log(`  relative_path ไม่ตรงสูตร: ${badPath}  (ต้องเป็น 0)`);
  console.log(`  ไฟล์หายบนดิสก์          : ${missing}  (ต้องเป็น 0)`);

  // ของปี 28 ที่อยู่ในโฟลเดอร์เดิมต้องไม่ถูกกระทบ
  const other = await systemDb('tax_documents')
    .where('is_active', 1).where('relative_path', 'like', `${WRONG_PREFIX}%`)
    .select('relative_path');
  let otherMissing = 0;
  for (const r of other as any[]) {
    if (!(await exists(path.resolve(storageDir, String(r.relative_path))))) otherMissing += 1;
  }
  console.log(`แถวอื่นที่ยังใช้ ${WRONG_PREFIX}  : ${other.length}  (ของปีภาษี 28 ต้องอยู่ครบ)`);
  console.log(`  ในนั้นไฟล์หาย           : ${otherMissing}  (ต้องเป็น 0)`);

  const ok = Number((left as any)[0].n) === 0 && !badPath && !missing && !otherMissing;
  console.log(ok ? '\nผ่านทุกข้อ · ลบไฟล์เดิมได้ด้วย --cleanup=<report.json>' : '\nไม่ผ่าน · อย่าเพิ่ง cleanup');
  if (!ok) process.exitCode = 4;
}

async function cleanup(reportFile: string, storageDir: string) {
  const report = JSON.parse(await fs.readFile(path.resolve(reportFile), 'utf8'));
  const items: PlanItem[] = report.items ?? [];
  console.log(`=== ลบไฟล์เดิม ${items.length} ไฟล์ตามรายงาน ===`);
  console.log(`ลบเฉพาะไฟล์ในรายการ ไม่ลบทั้งโฟลเดอร์ เพราะ ${WRONG_PREFIX} ยังมีไฟล์ของปีอื่นอยู่`);

  // ไม่มีแถวใดอ้างถึง path เดิมแล้วจริงหรือไม่
  const oldPaths = items.map((i) => i.oldPath);
  let referenced = 0;
  for (let i = 0; i < oldPaths.length; i += 500) {
    const hit = await systemDb('tax_documents').whereIn('relative_path', oldPaths.slice(i, i + 500)).count('* as n');
    referenced += Number((hit as any)[0].n);
  }
  console.log(`แถวที่ยังอ้างถึง path เดิม: ${referenced}  (ต้องเป็น 0)`);
  if (referenced > 0) throw new Error('ยังมีแถวอ้างถึง หยุด');

  let removed = 0, notFound = 0;
  for (const it of items) {
    const p = path.resolve(storageDir, it.oldPath);
    if (await exists(p)) { await fs.rm(p, { force: true }); removed += 1; }
    else notFound += 1;
  }
  console.log(`ลบแล้ว ${removed} · ไม่พบ ${notFound}`);
}

async function rollback(reportFile: string, storageDir: string) {
  const report = JSON.parse(await fs.readFile(path.resolve(reportFile), 'utf8'));
  const items: PlanItem[] = report.items ?? [];
  console.log(`=== ย้อนกลับ ${items.length} แถว ===`);
  let n = 0;
  for (const it of items) {
    const back = await systemDb('tax_documents').where({ id: it.id }).update({ relative_path: it.oldPath });
    if (Number(back) === 1) { await fs.rm(path.resolve(storageDir, it.newPath), { force: true }); n += 1; }
  }
  console.log(`คืนค่าแล้ว ${n} แถว และลบไฟล์ที่คัดลอกไป`);
}

main()
  .catch((e) => { console.error('\nล้มเหลว:', e?.message ?? e); process.exitCode = 1; })
  .finally(async () => { await systemDb.destroy(); });
