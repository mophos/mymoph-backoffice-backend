-- 007: ถอด FOREIGN KEY ที่ชี้ไป organizations ออกทั้งหมด
--
-- รันกับ production ไปแล้วเมื่อ 12 ตุลาคม 2569 (D-24)
-- ไฟล์นี้เพิ่มทีหลังเมื่อ 26 ตุลาคม 2569 เพื่อให้ migrations ตรงกับของจริง (OPS-05)
--
-- ทำไมต้องถอด
--   `organizations` มีเพียง 104 แถว แต่ทะเบียนหน่วยงานจริงคือ `hcode_health_office`
--   ซึ่งมี 44,428 แถว เมื่อ SCOPE-01 ขยายการตรวจไปใช้ทะเบียนกลาง
--   หน่วยงาน 41,114 แห่งจึงผ่าน validation แต่ไปล้มที่ COMMIT ด้วย
--   ER_NO_REFERENCED_ROW_2 ทำให้ให้สิทธิ์ สร้างปีภาษี และเพิ่มบุคลากรไม่ได้
--   ดู SCOPE-02 ใน work-list/work-clear-bug-repair/03-ISSUE-REGISTER.md
--
-- ข้อควรรู้ก่อนรันกับฐานใหม่
--   NDB ตรวจ FK ตอน COMMIT ไม่ใช่ตอน INSERT การทดสอบด้วย INSERT + ROLLBACK
--   จึงไม่เห็นปัญหา (DATA-02)
--   DROP FOREIGN KEY ไม่ใช่ online operation และจับ Global Schema Lock
--   ทำให้ DDL อื่นและ backup ของทั้งคลัสเตอร์รอ ควรทำนอกเวลาให้บริการ
--
-- ความถูกต้องของรหัสหน่วยงานหลังถอด FK บังคับที่ชั้นแอปผ่าน
-- `resolveOfficeCode()` / `resolveOfficeCodes()` ซึ่งตรวจกับ `hcode_health_office`

ALTER TABLE user_office_scope  DROP FOREIGN KEY fk_user_scope_hospcode;
ALTER TABLE tax_years          DROP FOREIGN KEY fk_tax_year_hospcode;
ALTER TABLE personnel_profiles DROP FOREIGN KEY fk_personnel_hospcode;
ALTER TABLE users              DROP FOREIGN KEY fk_users_default_hospcode;

-- ตรวจผล: ต้องไม่เหลือ FK ที่ชี้ไป organizations เลย
SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE()
   AND REFERENCED_TABLE_NAME = 'organizations';
