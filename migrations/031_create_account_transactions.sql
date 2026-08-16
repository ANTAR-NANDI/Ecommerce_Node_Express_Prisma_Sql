ALTER TABLE account_coa
  ADD UNIQUE KEY account_coa_customer_unique (customer_id),
  ADD UNIQUE KEY account_coa_supplier_unique (supplier_id),
  ADD UNIQUE KEY account_coa_employee_unique (employee_id);

CREATE TABLE account_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_no VARCHAR(60) NOT NULL,
  transaction_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  head_code BIGINT UNSIGNED NOT NULL,
  debit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  credit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  reference_type VARCHAR(60) NULL,
  reference_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NULL,
  employee_id BIGINT UNSIGNED NULL,
  description VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY account_transactions_number_index (transaction_no),
  KEY account_transactions_head_code_index (head_code),
  KEY account_transactions_reference_index (reference_type, reference_id),
  KEY account_transactions_customer_index (customer_id),
  KEY account_transactions_supplier_index (supplier_id),
  KEY account_transactions_employee_index (employee_id),
  CONSTRAINT account_transactions_head_code_fk FOREIGN KEY (head_code) REFERENCES account_coa(HeadCode) ON DELETE RESTRICT,
  CONSTRAINT account_transactions_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT account_transactions_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT account_transactions_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  CONSTRAINT account_transactions_balance_check CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
