INSERT INTO organizations (hospcode, name, province_code)
VALUES
  ('10700', 'MOPH Central Office', '10'),
  ('24001', 'MOPH Chachoengsao Hospital', '24'),
  ('50001', 'MOPH Chiang Mai Hospital', '50')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  province_code = VALUES(province_code),
  updated_at = CURRENT_TIMESTAMP;
