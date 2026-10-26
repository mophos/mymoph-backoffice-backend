-- 008: เพิ่มคอลัมน์ hospcode9 ให้ user_office_scope
--
-- รันกับ production ไปแล้วเมื่อ 25 กันยายน 2569 (D-14)
-- ไฟล์นี้เพิ่มทีหลังเมื่อ 26 ตุลาคม 2569 เพื่อให้ migrations ตรงกับของจริง (OPS-05)
--
-- ทำไมต้องมี
--   หน่วยงาน 3,198 แห่งในทะเบียนกลางมีแต่ hcode9 ไม่มีรหัส 5 หลัก
--   ถ้าเก็บได้แต่ `hospcode` (5 หลัก) จะให้สิทธิ์หน่วยงานเหล่านั้นไม่ได้เลย
--   ดู SCOPE-01 และ 14-HCODE9-READINESS.md
--
-- ข้อควรรู้ก่อนรันกับฐานใหม่
--   NDB จะทำ online ได้ก็ต่อเมื่อคอลัมน์เป็น NULL, DEFAULT NULL,
--   COLUMN_FORMAT DYNAMIC และต่อท้ายตารางเท่านั้น
--   ระบุ ALGORITHM=INPLACE ไว้เพื่อให้ล้มเหลวทันทีถ้าทำ online ไม่ได้
--   แทนที่จะเงียบ ๆ ไป rebuild ทั้งตาราง
--   NDB ไม่รองรับ DROP COLUMN แบบ online การย้อนกลับจึงต้อง rebuild แบบ offline
--
--   โค้ดฝั่งแอปตรวจเองว่ามีคอลัมน์นี้หรือยัง (`getScopeMeta`)
--   จึงรันก่อนหรือหลัง deploy ก็ได้ ไม่ต้องเรียงลำดับ

ALTER TABLE user_office_scope
  ADD COLUMN hospcode9 varchar(9) NULL DEFAULT NULL COLUMN_FORMAT DYNAMIC,
  ALGORITHM=INPLACE;

-- เติมค่าให้แถวที่มีอยู่จากทะเบียนกลาง
UPDATE user_office_scope AS s
  JOIN hcode_health_office AS o ON o.code5 = s.hospcode
   SET s.hospcode9 = o.hcode9
 WHERE s.hospcode9 IS NULL;

-- ตรวจผล: ต้องไม่เหลือแถวที่มี hospcode แต่ยังไม่มี hospcode9
SELECT COUNT(*) AS แถวที่ยังขาด_hospcode9
  FROM user_office_scope
 WHERE hospcode IS NOT NULL AND hospcode9 IS NULL;
