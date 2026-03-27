SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS tax_years (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  year_be SMALLINT UNSIGNED NOT NULL,
  hospcode VARCHAR(10) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tax_year_hospcode (year_be, hospcode),
  KEY idx_tax_year_hospcode (hospcode),
  KEY idx_tax_year_active (is_active),
  CONSTRAINT fk_tax_year_hospcode FOREIGN KEY (hospcode) REFERENCES organizations(hospcode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tax_documents (
  id CHAR(36) PRIMARY KEY,
  tax_year_id BIGINT NOT NULL,
  year_be SMALLINT UNSIGNED NOT NULL,
  hospcode VARCHAR(10) NOT NULL,
  cid VARCHAR(13) NOT NULL,
  file_no INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_file_name VARCHAR(255) NULL,
  relative_path VARCHAR(500) NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tax_doc_yearbe_cid_file (year_be, cid, file_no),
  KEY idx_tax_doc_year (tax_year_id),
  KEY idx_tax_doc_year_be (year_be),
  KEY idx_tax_doc_hospcode (hospcode),
  KEY idx_tax_doc_cid (cid),
  KEY idx_tax_doc_active (is_active),
  CONSTRAINT fk_tax_doc_year FOREIGN KEY (tax_year_id) REFERENCES tax_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
