CREATE TABLE cheques (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cheque_number VARCHAR(100) NOT NULL,
  cheque_type ENUM('issued', 'received') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  issued_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cheques_account_index (account_id),
  KEY cheques_number_index (cheque_number),
  CONSTRAINT cheques_account_fk FOREIGN KEY (account_id) REFERENCES account_coa(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cheque_statuses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cheque_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'passed', 'withdrawn', 'bounced', 'cancelled') NOT NULL,
  status_date DATE NOT NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cheque_statuses_cheque_index (cheque_id, id),
  CONSTRAINT cheque_statuses_cheque_fk FOREIGN KEY (cheque_id) REFERENCES cheques(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE supplier_payments
  ADD COLUMN purchase_id BIGINT UNSIGNED NULL AFTER supplier_id,
  ADD COLUMN payment_method_id TINYINT UNSIGNED NULL AFTER payment_method,
  ADD COLUMN account_id BIGINT UNSIGNED NULL AFTER payment_method_id,
  ADD COLUMN cheque_id BIGINT UNSIGNED NULL AFTER account_id,
  ADD KEY supplier_payments_purchase_index (purchase_id),
  ADD KEY supplier_payments_cheque_index (cheque_id),
  ADD CONSTRAINT supplier_payments_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  ADD CONSTRAINT supplier_payments_cheque_fk FOREIGN KEY (cheque_id) REFERENCES cheques(id) ON DELETE RESTRICT;

INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive, IsTransaction, IsGL, IsJournal, HeadType, node_type, allows_manual_children, is_system, CreateBy, CreateDate)
SELECT 2000105, 'Cheques Payable', 'Current Liabilities', id, 3, TRUE, TRUE, FALSE, TRUE, 'L', 'ledger', FALSE, TRUE, 'Seeding', CURDATE()
FROM account_coa WHERE HeadCode = 20001
ON DUPLICATE KEY UPDATE HeadName = VALUES(HeadName);
