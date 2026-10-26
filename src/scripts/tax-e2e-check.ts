import { PDFDocument } from 'pdf-lib';
import { systemDb } from '../db/knex';
import { config } from '../config/env';

/**
 * ทดสอบเส้นทางที่แอป MyMOPH ใช้จริง โดยไม่ต้องรอให้มีคนเข้ามาใช้
 *
 * ทำซ้ำทุกขั้นที่ mymoph-api ทำ
 *   1. getTaxYearsByCid        — หาปีจาก tax_documents join tax_years
 *   2. getTaxDocumentsByCidYear — เอกสารของปีนั้น เรียง file_no, file_name
 *   3. fetchAdminTaxFileBuffer  — ยิง GET /tax/internal/documents/:id/file พร้อม x-internal-api-key
 *   4. mergePdfBuffers          — รวมทุกชิ้นเป็น PDF เดียว
 *
 * ตรวจว่าได้ไฟล์จริง เปิดได้ และจำนวนหน้าตรงกับที่ควรเป็น
 *
 * **อ่านอย่างเดียว** ไม่เขียนฐาน ไม่แตะไฟล์
 * แต่จะมีรายการเพิ่มใน audit_logs เพราะ endpoint บันทึก internal_download_document ทุกครั้ง
 * ซึ่งเป็นเรื่องปกติและใช้ยืนยันได้ว่าการบันทึกทำงาน
 */

const usage = `
ใช้งาน
  npx tsx src/scripts/tax-e2e-check.ts [--base=http://127.0.0.1:PORT] [--n=20]

  --base   ที่อยู่ของหลังบ้าน ค่าเริ่มต้นคือ http://127.0.0.1:<PORT ใน .env>
  --n      จำนวนตัวอย่างต่อกลุ่ม ค่าเริ่มต้น 20
`;

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const i of argv) {
    if (!i.startsWith('--')) continue;
    const raw = i.slice(2); const eq = raw.indexOf('=');
    if (eq >= 0) out[raw.slice(0, eq)] = raw.slice(eq + 1); else out[raw] = true;
  }
  return out;
}

const ys = (y: number) => String(y % 100).padStart(2, '0');

/** เหมือน getTaxYearsByCid ใน mymoph-api */
async function appYears(cid: string): Promise<string[]> {
  const rows = await systemDb('tax_documents as d')
    .innerJoin('tax_years as y', 'y.id', 'd.tax_year_id')
    .where('d.cid', cid).andWhere('d.is_active', 1).andWhere('y.is_active', 1)
    .groupBy('d.year_be').orderBy('d.year_be', 'desc').select('d.year_be');
  return (rows as any[]).map((r) => ys(Number(r.year_be)));
}

/** เหมือน getTaxDocumentsByCidYear ใน mymoph-api */
async function appDocs(cid: string, yearBe: number) {
  return systemDb('tax_documents as d')
    .innerJoin('tax_years as y', 'y.id', 'd.tax_year_id')
    .where('d.cid', cid).andWhere('d.year_be', yearBe)
    .andWhere('d.is_active', 1).andWhere('y.is_active', 1)
    .orderBy('d.file_no', 'asc').orderBy('d.file_name', 'asc')
    .select('d.id', 'd.file_no', 'd.file_name');
}

interface Sample { label: string; cid: string; yearBe: number; expectDocs: number }

async function pickSamples(n: number): Promise<Sample[]> {
  const out: Sample[] = [];
  const add = async (label: string, q: any, yearBe: number) => {
    const rows = await q;
    for (const r of rows as any[]) {
      const cid = String(r.cid);
      const docs = await appDocs(cid, yearBe);
      out.push({ label, cid, yearBe, expectDocs: docs.length });
    }
  };

  await add('ปี 2566 นำเข้าใหม่', systemDb('tax_documents').where({ year_be: 2566, is_active: 1 })
    .select('cid').orderByRaw('RAND()').limit(n), 2566);
  await add('ปี 2567 นำเข้าใหม่', systemDb('tax_documents').where({ year_be: 2567, is_active: 1 })
    .select('cid').orderByRaw('RAND()').limit(n), 2567);
  await add('ปี 2567 ไฟล์เดิม 2 หน้า', systemDb('tax_documents').where({ year_be: 2567, is_active: 1 })
    .where('file_no', '>', 1).select('cid').limit(n), 2567);
  await add('TAX-12 เคยเป็นปี 2500', systemDb('tax_documents').where({ tax_year_id: 14, is_active: 1 })
    .select('cid').orderByRaw('RAND()').limit(n), 2568);
  await add('TAX-15 ไฟล์ที่ย้ายมา', systemDb('tax_documents').where({ tax_year_id: 29, is_active: 1 })
    .select('cid').orderByRaw('RAND()').limit(n), 2568);
  await add('ปี 2568 ทั่วไป', systemDb('tax_documents').where({ year_be: 2568, is_active: 1 })
    .whereNotIn('tax_year_id', [14, 29]).select('cid').orderByRaw('RAND()').limit(n), 2568);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  const base = (typeof args.base === 'string' ? args.base : `http://127.0.0.1:${config.port}`).replace(/\/+$/, '');
  const n = Number(args.n) > 0 ? Math.floor(Number(args.n)) : 20;
  const key = config.taxInternalApiKey;
  if (!key) throw new Error('ไม่พบ TAX_INTERNAL_API_KEY ใน .env');

  console.log(`ยิงไปที่ ${base}/api/v1/tax/internal/documents/:id/file`);
  console.log(`ตัวอย่างกลุ่มละ ${n} คน · อ่านอย่างเดียว\n`);

  const samples = await pickSamples(n);
  const byLabel = new Map<string, { ok: number; fail: number; pages: Map<number, number>; errs: Map<string, number> }>();

  for (const s of samples) {
    const g = byLabel.get(s.label) ?? { ok: 0, fail: 0, pages: new Map(), errs: new Map() };
    byLabel.set(s.label, g);

    const years = await appYears(s.cid);
    if (!years.includes(ys(s.yearBe))) {
      g.fail += 1; g.errs.set('แอปไม่เห็นปีนี้ในรายการ', (g.errs.get('แอปไม่เห็นปีนี้ในรายการ') ?? 0) + 1);
      continue;
    }

    const docs = await appDocs(s.cid, s.yearBe);
    const buffers: Buffer[] = [];
    let failed: string | null = null;

    for (const d of docs as any[]) {
      const url = `${base}/api/v1/tax/internal/documents/${encodeURIComponent(String(d.id))}/file?cid=${s.cid}`;
      try {
        const res = await fetch(url, { headers: { 'x-internal-api-key': key } });
        if (res.status !== 200) { failed = `HTTP ${res.status}`; break; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 4).toString('latin1') !== '%PDF') { failed = 'ไฟล์ที่ได้ไม่ใช่ PDF'; break; }
        buffers.push(buf);
      } catch (e: any) { failed = `เรียกไม่สำเร็จ ${String(e?.message ?? e).slice(0, 40)}`; break; }
    }

    if (failed) {
      g.fail += 1; g.errs.set(failed, (g.errs.get(failed) ?? 0) + 1);
      continue;
    }

    try {
      const merged = await PDFDocument.create();
      for (const b of buffers) {
        const d = await PDFDocument.load(b);
        const ps = await merged.copyPages(d, d.getPageIndices());
        ps.forEach((p) => merged.addPage(p));
      }
      const total = merged.getPageCount();
      g.pages.set(total, (g.pages.get(total) ?? 0) + 1);
      if (total !== docs.length) {
        g.fail += 1; g.errs.set(`หน้ารวม ${total} ไม่เท่าจำนวนเอกสาร ${docs.length}`, 1);
      } else g.ok += 1;
    } catch (e: any) {
      g.fail += 1; g.errs.set(`รวม PDF ไม่ได้ ${String(e?.message ?? e).slice(0, 40)}`, 1);
    }
  }

  let allOk = 0, allFail = 0;
  for (const [label, g] of byLabel) {
    allOk += g.ok; allFail += g.fail;
    const pg = [...g.pages].sort().map(([k, v]) => `${k} หน้า x${v}`).join(' · ');
    console.log(`${label}`);
    console.log(`  สำเร็จ ${g.ok} · ล้มเหลว ${g.fail} · ${pg}`);
    for (const [e, c] of g.errs) console.log(`     ${c}  ${e}`);
  }
  console.log(`\nรวม สำเร็จ ${allOk} · ล้มเหลว ${allFail}`);
  console.log(allFail ? 'ไม่ผ่าน' : 'ผ่านทั้งหมด — เส้นทางที่แอปใช้ทำงานได้จริงทุกกลุ่ม');
  if (allFail) process.exitCode = 4;
}

main()
  .catch((e) => { console.error('\nล้มเหลว:', e?.message ?? e); process.exitCode = 1; })
  .finally(async () => { await systemDb.destroy(); });
