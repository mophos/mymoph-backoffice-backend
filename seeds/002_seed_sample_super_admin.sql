-- Optional sample bootstrap user (replace CID before production)
INSERT INTO users (id, cid, first_name, last_name, email, default_hospcode, is_active)
VALUES ('7a2759a6-0937-426d-9f6e-e6f95c4c5001', '0000000000000', 'System', 'users', 'admin@example.org', '10700', 1)
ON DUPLICATE KEY UPDATE
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  email = VALUES(email),
  default_hospcode = VALUES(default_hospcode),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO user_roles (id, user_id, role_id, is_active)
VALUES (
  '9bc9ca2d-f4a3-4f13-9a5b-4d95f0355001',
  '7a2759a6-0937-426d-9f6e-e6f95c4c5001',
  '4acb2704-4499-44c7-b335-660a5f8dd004',
  1
)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;
