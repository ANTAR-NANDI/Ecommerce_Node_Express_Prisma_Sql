ALTER TABLE account_transactions
  ADD COLUMN sale_id BIGINT UNSIGNED NULL AFTER reference_id,
  ADD COLUMN purchase_id BIGINT UNSIGNED NULL AFTER sale_id,
  ADD KEY account_transactions_sale_index (sale_id),
  ADD KEY account_transactions_purchase_index (purchase_id),
  ADD CONSTRAINT account_transactions_sale_fk FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE RESTRICT,
  ADD CONSTRAINT account_transactions_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT;

UPDATE account_transactions
SET sale_id = reference_id
WHERE reference_type = 'pos_sale' AND sale_id IS NULL;

UPDATE account_transactions
SET purchase_id = reference_id
WHERE reference_type = 'purchase' AND purchase_id IS NULL;

UPDATE account_transactions at
JOIN supplier_payments sp ON sp.id = at.reference_id
SET at.purchase_id = sp.purchase_id
WHERE at.reference_type = 'supplier_payment' AND at.purchase_id IS NULL;
