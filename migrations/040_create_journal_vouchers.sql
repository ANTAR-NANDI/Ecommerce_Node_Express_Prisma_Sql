CREATE TABLE journal_vouchers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_number VARCHAR(60) NOT NULL,
  voucher_date DATE NOT NULL,
  ledger_comment VARCHAR(1000) NOT NULL,
  sub_type VARCHAR(100) NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY journal_vouchers_number_unique (voucher_number),
  KEY journal_vouchers_date_index (voucher_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE journal_voucher_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  journal_voucher_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY journal_voucher_entries_voucher_index (journal_voucher_id),
  KEY journal_voucher_entries_account_index (account_id),
  CONSTRAINT journal_voucher_entries_voucher_fk FOREIGN KEY (journal_voucher_id) REFERENCES journal_vouchers(id) ON DELETE CASCADE,
  CONSTRAINT journal_voucher_entries_account_fk FOREIGN KEY (account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT journal_voucher_entries_amount_check CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
