SET NAMES utf8mb4;

-- Roles
INSERT INTO roles (id, code, name, description, is_active)
VALUES
  ('4acb2704-4499-44c7-b335-660a5f8dd001', 'hr', 'HR', 'HR office role', 1),
  ('4acb2704-4499-44c7-b335-660a5f8dd002', 'admin_affairs', 'Admin Affairs', 'Payroll and finance docs role', 1),
  ('4acb2704-4499-44c7-b335-660a5f8dd003', 'it_office', 'IT Office', 'Office settings role', 1),
  ('4acb2704-4499-44c7-b335-660a5f8dd004', 'super_admin', 'Super Admin', 'Global administrator', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

-- Permissions
INSERT INTO permissions (id, code, module, action, description, is_active)
VALUES
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1001', 'attendance.read', 'attendance', 'read', 'View attendance dashboard and records', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1002', 'attendance.export', 'attendance', 'export', 'Export attendance report', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1003', 'payroll.read', 'payroll', 'read', 'View payroll', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1004', 'payroll.export', 'payroll', 'export', 'Export payroll', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1005', 'office_settings.read', 'office-settings', 'read', 'View office settings', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1006', 'office_settings.update', 'office-settings', 'update', 'Update office settings', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1007', 'user_admin.manage', 'user-role-management', 'manage', 'Manage user-role assignment', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1008', 'role_admin.manage', 'user-role-management', 'manage_roles', 'Manage role definitions', 1)
ON DUPLICATE KEY UPDATE
  module = VALUES(module),
  action = VALUES(action),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

-- Role -> Permission Matrix
-- hr
INSERT INTO role_permissions (id, role_id, permission_id, is_active)
VALUES
  ('8cc7f318-20c5-457d-beb9-e3f1caef1001', '4acb2704-4499-44c7-b335-660a5f8dd001', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1001', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1002', '4acb2704-4499-44c7-b335-660a5f8dd001', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1002', 1),

  -- admin_affairs
  ('8cc7f318-20c5-457d-beb9-e3f1caef1003', '4acb2704-4499-44c7-b335-660a5f8dd002', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1003', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1004', '4acb2704-4499-44c7-b335-660a5f8dd002', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1004', 1),

  -- it_office
  ('8cc7f318-20c5-457d-beb9-e3f1caef1005', '4acb2704-4499-44c7-b335-660a5f8dd003', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1005', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1006', '4acb2704-4499-44c7-b335-660a5f8dd003', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1006', 1),

  -- super_admin (all)
  ('8cc7f318-20c5-457d-beb9-e3f1caef1007', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1001', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1008', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1002', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1009', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1003', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1010', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1004', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1011', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1005', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1012', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1006', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1013', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1007', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1014', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1008', 1)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;
