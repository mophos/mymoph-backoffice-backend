import type { Knex } from 'knex';

export const HCODE_TABLE = 'hcode_health_office';

/**
 * ตัวแปลงรหัสสถานพยาบาลระหว่างมาตรฐานเก่า (code5) กับใหม่ (hcode9)
 *
 * มาตรฐานกลางกำลังย้ายจาก code5 ไป hcode9 แต่ระบบในเครืออัปเดตพร้อมกันไม่ได้
 * Back Office จึงเก็บ hcode9 เป็นความจริงภายใน แล้วแปลงเฉพาะตอนคุยกับระบบที่ยังใช้ code5
 *
 * **ไฟล์นี้ตั้งใจให้ถูกลบทิ้ง** เมื่อ mymoph-api และ mymoph-app ย้ายเสร็จ
 * ห้ามเขียนโค้ดแปลงรหัสที่อื่น เพราะถ้ากระจายอยู่หลายที่
 * จะไม่มีวันรู้ว่าปลอดภัยที่จะถอดออกเมื่อไหร่
 *
 * ดู work-list/work-clear-bug-repair/11-HCODE-MIGRATION.md
 */
export class HcodeBridgeService {
  /**
   * นับการใช้งานแยกตามผู้เรียก เพื่อให้รู้ว่าเมื่อไหร่ถอด bridge ได้
   * ตัวเลขอยู่ในหน่วยความจำของ process ไม่ใช่สถิติระยะยาว
   * ใช้ตอบคำถามว่า "ยังมีใครเรียกอยู่ไหม" ไม่ใช่เพื่อรายงาน
   */
  private readonly usage = new Map<string, number>();

  constructor(private readonly db: Knex) {}

  /**
   * hcode9 -> code5 สำหรับส่งออกไปยังระบบที่ยังใช้มาตรฐานเก่า
   * คืน null เมื่อหน่วยงานนั้นไม่มี code5 ซึ่งเกิดกับสถานพยาบาลเอกชนเป็นส่วนใหญ่
   * ผู้เรียกต้องจัดการกรณี null เอง ไม่ใช่ถือว่าเป็นข้อผิดพลาด
   */
  async toCode5(hcode9: string, calledBy: string): Promise<string | null> {
    this.track(`${calledBy}:toCode5`);

    const row = await this.db(HCODE_TABLE)
      .where({ hcode9 })
      .select('code5')
      .first();

    const code5 = row?.code5 ? String(row.code5).trim() : '';
    return code5 || null;
  }

  /** แปลงหลายรหัสพร้อมกัน ใช้กับการกรอง Scope ที่มีหลายหน่วยงาน */
  async toCode5Many(hcode9List: string[], calledBy: string): Promise<string[]> {
    if (!hcode9List.length) return [];
    this.track(`${calledBy}:toCode5Many`);

    const rows = await this.db(HCODE_TABLE)
      .whereIn('hcode9', hcode9List)
      .whereNotNull('code5')
      .andWhere('code5', '<>', '')
      .select('code5');

    return [...new Set(rows.map((row) => String(row.code5).trim()))];
  }

  /**
   * code5 -> hcode9 สำหรับรับข้อมูลจากระบบที่ยังใช้มาตรฐานเก่า
   *
   * code5 ไม่ unique มี 3 คู่ที่ซ้ำ (42477, 42478, 44583)
   * กติกาเลือก: เอาแถวที่ active ก่อน ถ้ายังซ้ำเอา modified_date ล่าสุด
   * และบันทึกไว้ว่าเกิดการเลือกขึ้น เพื่อให้ตรวจสอบย้อนหลังได้
   */
  async toHcode9(code5: string, calledBy: string): Promise<string | null> {
    this.track(`${calledBy}:toHcode9`);

    const rows = await this.db(HCODE_TABLE)
      .where({ code5 })
      .orderBy([
        { column: 'active', order: 'desc' },
        { column: 'modified_date', order: 'desc' }
      ])
      .select('hcode9', 'active', 'modified_date')
      .limit(2);

    if (!rows.length) return null;

    if (rows.length > 1) {
      console.warn(
        `[hcode-bridge] code5=${code5} ตรงกับหลายหน่วยงาน เลือก hcode9=${rows[0].hcode9} ตามกติกา active/modified_date (ผู้เรียก: ${calledBy})`
      );
    }

    return String(rows[0].hcode9);
  }

  /**
   * แปลงรหัสที่รับเข้ามาให้เป็นรูปแบบที่ระบบเก็บจริง ซึ่งตอนนี้คือ code5
   *
   * รับได้ทั้ง code5 และ hcode9 และนับแยกว่าแต่ละรูปแบบถูกส่งมากี่ครั้ง
   * ตัวเลขนี้คือสิ่งที่บอกว่าเมื่อไหร่ frontend เลิกส่ง code5 แล้ว
   * และเมื่อไหร่ที่ปลอดภัยจะสลับให้เก็บ hcode9 แทน
   *
   * คืน null สำหรับรหัสที่ไม่พบในทะเบียน หรือหน่วยงานที่ไม่มี code5
   */
  async normalizeToStored(codes: string[], calledBy: string): Promise<(string | null)[]> {
    if (!codes.length) return [];

    const rows = await this.db(HCODE_TABLE)
      .where((builder) => {
        builder.whereIn('code5', codes).orWhereIn('hcode9', codes);
      })
      .orderBy([{ column: 'active', order: 'desc' }])
      .select('code5', 'hcode9');

    const byCode5 = new Map<string, string>();
    const byHcode9 = new Map<string, string>();
    for (const row of rows) {
      const code5 = row.code5 ? String(row.code5).trim() : '';
      const hcode9 = String(row.hcode9);
      if (code5 && !byCode5.has(code5)) byCode5.set(code5, code5);
      if (!byHcode9.has(hcode9)) byHcode9.set(hcode9, code5 || '');
    }

    return codes.map((code) => {
      if (byCode5.has(code)) {
        this.track(`${calledBy}:received-code5`);
        return code;
      }
      if (byHcode9.has(code)) {
        this.track(`${calledBy}:received-hcode9`);
        return byHcode9.get(code) || null;
      }
      this.track(`${calledBy}:unknown-code`);
      return null;
    });
  }

  /** ตัวเลขการใช้งานสำหรับตัดสินใจว่าถอด bridge ได้หรือยัง */
  getUsageReport(): Record<string, number> {
    return Object.fromEntries(this.usage);
  }

  private track(key: string): void {
    this.usage.set(key, (this.usage.get(key) ?? 0) + 1);
  }
}
