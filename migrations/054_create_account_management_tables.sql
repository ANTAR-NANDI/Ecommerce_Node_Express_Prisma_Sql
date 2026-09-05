CREATE TABLE financial_years (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY financial_years_name_unique (name),
  CONSTRAINT financial_years_dates_check CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE opening_balances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  offset_account_id BIGINT UNSIGNED NOT NULL,
  opening_date DATE NOT NULL,
  entry_type ENUM('debit','credit') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  note VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY opening_balances_year_index (financial_year_id),
  CONSTRAINT opening_balances_year_fk FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE RESTRICT,
  CONSTRAINT opening_balances_account_fk FOREIGN KEY (account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT opening_balances_offset_fk FOREIGN KEY (offset_account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT opening_balances_amount_check CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_methods (
  id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  method_key VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  requires_bank_account BOOLEAN NOT NULL DEFAULT FALSE,
  requires_cheque_number BOOLEAN NOT NULL DEFAULT FALSE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY payment_methods_key_unique (method_key),
  UNIQUE KEY payment_methods_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO payment_methods (id, method_key, name, requires_bank_account, requires_cheque_number, requires_approval, is_active) VALUES
  (1, 'cash', 'Cash', FALSE, FALSE, FALSE, TRUE),
  (2, 'bank_transfer', 'Transfer', TRUE, FALSE, FALSE, TRUE),
  (3, 'cheque', 'Cheque', FALSE, TRUE, TRUE, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE bank_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bank_id BIGINT UNSIGNED NOT NULL,
  statement_date DATE NOT NULL,
  statement_closing_balance DECIMAL(15,2) NOT NULL,
  book_balance DECIMAL(15,2) NOT NULL,
  difference_amount DECIMAL(15,2) NOT NULL,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY bank_reconciliations_bank_index (bank_id),
  CONSTRAINT bank_reconciliations_bank_fk FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE bank_reconciliation_entries (
  reconciliation_id BIGINT UNSIGNED NOT NULL,
  account_transaction_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (reconciliation_id, account_transaction_id),
  CONSTRAINT bank_reconciliation_entries_reconciliation_fk FOREIGN KEY (reconciliation_id) REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  CONSTRAINT bank_reconciliation_entries_transaction_fk FOREIGN KEY (account_transaction_id) REFERENCES account_transactions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
