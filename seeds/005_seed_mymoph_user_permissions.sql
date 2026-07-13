SET NAMES utf8mb4;

INSERT INTO roles (id, code, name, description, is_active)
VALUES
  ('4acb2704-4499-44c7-b335-660a5f8dd006', 'user_mymoph', 'User MyMOPH Admin', 'Manage users in the MyMOPH identity directory', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO permissions (id, code, module, action, description, is_active)
VALUES
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1012', 'mymoph_user.read', 'mymoph-users', 'read', 'Search and view MyMOPH users', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1013', 'mymoph_user.verify_hr', 'mymoph-users', 'verify_hr', 'Verify MyMOPH user against HR status service', 1),
  ('5f58f8c0-f16b-4cbc-879f-c90a3c2a1014', 'mymoph_user.delete', 'mymoph-users', 'delete', 'Archive and delete MyMOPH users', 1)
ON DUPLICATE KEY UPDATE
  module = VALUES(module),
  action = VALUES(action),
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO role_permissions (id, role_id, permission_id, is_active)
VALUES
  ('8cc7f318-20c5-457d-beb9-e3f1caef1022', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1012', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1023', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1013', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1024', '4acb2704-4499-44c7-b335-660a5f8dd004', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1014', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1025', '4acb2704-4499-44c7-b335-660a5f8dd006', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1012', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1026', '4acb2704-4499-44c7-b335-660a5f8dd006', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1013', 1),
  ('8cc7f318-20c5-457d-beb9-e3f1caef1027', '4acb2704-4499-44c7-b335-660a5f8dd006', '5f58f8c0-f16b-4cbc-879f-c90a3c2a1014', 1)
ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP;
