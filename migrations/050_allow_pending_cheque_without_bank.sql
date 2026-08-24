-- A pending cheque is not tied to a bank ledger until it is passed.
ALTER TABLE cheques
  MODIFY COLUMN account_id BIGINT UNSIGNED NULL;

ALTER TABLE customer_payments
  MODIFY COLUMN account_id BIGINT UNSIGNED NULL;
