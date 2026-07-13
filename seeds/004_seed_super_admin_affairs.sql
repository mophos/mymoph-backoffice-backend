SET NAMES utf8mb4;

INSERT INTO roles (id, code, name, description, is_active)
VALUES
  ('4acb2704-4499-44c7-b335-660a5f8dd005', 'super_admin_affairs', 'Super Admin Affairs', 'Finance affairs administrator', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO permissions (id, code, module, action, description, is_active)
VALUES
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1011', 'finance_admin.manage', 'user-role-management', 'manage_finance_admin', 'Manage finance office admins', 1)
ON DUPLICATE KEY UPDATE
  module = VALUES(module),
  action = VALUES(action),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, role_id, permission_id, is_active)
VALUES
  ('8cc7f318-20c5-457d-beb9-e3f1caef1020', '4acb2704-4499-44c7-b335-660a5f8dd005', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1011', 1)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

UPDATE role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
SET
  rp.is_active = 0,
  rp.updated_at = CURRENT_TIMESTAMP
WHERE r.code = 'super_admin_affairs'
  AND p.code <> 'finance_admin.manage'
  AND rp.is_active = 1;
