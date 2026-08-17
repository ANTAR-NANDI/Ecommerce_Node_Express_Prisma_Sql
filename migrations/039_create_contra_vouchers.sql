CREATE TABLE contra_vouchers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_number VARCHAR(60) NOT NULL,
  voucher_date DATE NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  reverse_account_id BIGINT UNSIGNED NOT NULL,
  ledger_comment VARCHAR(1000) NOT NULL,
  sub_type VARCHAR(100) NULL,
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY contra_vouchers_number_unique (voucher_number),
  KEY contra_vouchers_date_index (voucher_date),
  KEY contra_vouchers_account_index (account_id),
  KEY contra_vouchers_reverse_account_index (reverse_account_id),
  CONSTRAINT contra_vouchers_account_fk FOREIGN KEY (account_id) REFERENCES account_coa(id) ON DELETE RESTRICT,
  CONSTRAINT contra_vouchers_reverse_account_fk FOREIGN KEY (reverse_account_id) REFERENCES account_coa(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
