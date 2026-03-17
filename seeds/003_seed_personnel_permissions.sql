SET NAMES utf8mb4;

INSERT INTO permissions (id, code, module, action, description, is_active)
VALUES
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1009', 'personnel.read', 'personnel', 'read', 'View personnel in organization scope', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1010', 'personnel.manage', 'personnel', 'manage', 'Create, update, delete, and upload personnel data', 1)
ON DUPLICATE KEY UPDATE
  module = VALUES(module),
  action = VALUES(action),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, role_id, permission_id, is_active)
VALUES
  ('8cc7f318-20c5-457d-beb9-e3f1caef1015', '4acb2704-4499-44c7-b335-660a5f8dd001', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1009', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1016', '4acb2704-4499-44c7-b335-660a5f8dd001', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1010', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1017', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1009', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1018', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1010', 1)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;
