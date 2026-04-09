SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS tax_document_delete_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  tax_year_id BIGINT NOT NULL,
  year_be SMALLINT UNSIGNED NOT NULL,
  hospcode VARCHAR(10) NOT NULL,
  cid VARCHAR(13) NOT NULL,
  file_no INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_file_name VARCHAR(255) NULL,
  relative_path VARCHAR(500) NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  deleted_by CHAR(36) NULL,
  delete_reason VARCHAR(50) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tax_doc_delete_log_document (document_id),
  KEY idx_tax_doc_delete_log_year (tax_year_id),
  KEY idx_tax_doc_delete_log_hospcode (hospcode),
  KEY idx_tax_doc_delete_log_cid (cid),
  KEY idx_tax_doc_delete_log_reason (delete_reason),
  KEY idx_tax_doc_delete_log_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tax_document_delete_logs (
  document_id,
  tax_year_id,
  year_be,
  hospcode,
  cid,
  file_no,
  file_name,
  original_file_name,
  relative_path,
  source_type,
  deleted_by,
  delete_reason,
  deleted_at
)
SELECT
  d.id,
  d.tax_year_id,
  d.year_be,
  d.hospcode,
  d.cid,
  d.file_no,
  d.file_name,
  d.original_file_name,
  d.relative_path,
  d.source_type,
  d.updated_by,
  'legacy_soft_delete',
  d.updated_at
FROM tax_documents d
WHERE d.is_active = 0
  AND NOT EXISTS (
    SELECT 1
    FROM tax_document_delete_logs l
    WHERE l.document_id = d.id
  );

DELETE FROM tax_documents
WHERE is_active = 0;
