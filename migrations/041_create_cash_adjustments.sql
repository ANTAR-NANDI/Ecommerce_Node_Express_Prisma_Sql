CREATE TABLE cash_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_number VARCHAR(60) NOT NULL,
  adjustment_date DATE NOT NULL,
  adjustment_type ENUM('debit', 'credit') NOT NULL,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  offset_account_id BIGINT UNSIGNED NOT NULL,
  remarks VARCHAR(1000) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY cash_adjustments_number_unique (voucher_number),
  KEY cash_adjustments_date_index (adjustment_date),
  CONSTRAINT cash_adjustments_cash_account_fk FOREIGN KEY (cash_account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT cash_adjustments_offset_account_fk FOREIGN KEY (offset_account_id) REFERENCES account_coa(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive, IsTransaction, IsGL, IsJournal, HeadType, node_type, allows_manual_children, is_system, CreateBy, CreateDate)
SELECT 5000205, 'Cash Shortage Expense', 'Operating Expenses', id, 3, TRUE, TRUE, FALSE, TRUE, 'E', 'ledger', FALSE, TRUE, 'Seeding', CURDATE()
FROM account_coa WHERE HeadCode = 50002
ON DUPLICATE KEY UPDATE HeadName = VALUES(HeadName);
