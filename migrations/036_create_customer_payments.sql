CREATE TABLE customer_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_number VARCHAR(60) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  payment_method_id TINYINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  cheque_id BIGINT UNSIGNED NULL,
  remarks VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_payments_number_unique (payment_number),
  KEY customer_payments_customer_index (customer_id),
  KEY customer_payments_order_index (order_id),
  KEY customer_payments_cheque_index (cheque_id),
  CONSTRAINT customer_payments_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_order_fk FOREIGN KEY (order_id) REFERENCES ecommerce_orders(id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_account_fk FOREIGN KEY (account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_cheque_fk FOREIGN KEY (cheque_id) REFERENCES cheques(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive, IsTransaction, IsGL, IsJournal, HeadType, node_type, allows_manual_children, is_system, CreateBy, CreateDate)
SELECT 1000105, 'Cheques Receivable', 'Current Assets', id, 3, TRUE, TRUE, FALSE, TRUE, 'A', 'ledger', FALSE, TRUE, 'Seeding', CURDATE()
FROM account_coa WHERE HeadCode = 10001
ON DUPLICATE KEY UPDATE HeadName = VALUES(HeadName);
