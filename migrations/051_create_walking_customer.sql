ALTER TABLE customers
  ADD COLUMN is_walk_in BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active,
  ADD KEY customers_walk_in_index (is_walk_in);

INSERT INTO customers (id, name, first_name, last_name, phone, email, address, is_active, is_walk_in)
VALUES (1, 'Walking Customer', 'Walking', 'Customer', 'WALK-IN-CUSTOMER', NULL, NULL, TRUE, TRUE)
ON DUPLICATE KEY UPDATE
  id = LAST_INSERT_ID(id),
  name = VALUES(name),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  is_active = TRUE,
  is_walk_in = TRUE;

SET @walking_customer_id := 1;
SET @customer_receivable_parent_id := (SELECT id FROM account_coa WHERE HeadCode = 1000109 LIMIT 1);
-- Reserve 100010900 for the system Walking Customer. Normal customer ledgers
-- created later start at 100010901.
SET @walking_customer_head_code := 100010900;

INSERT INTO account_coa (
  HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive,
  IsTransaction, IsGL, IsJournal, HeadType, node_type,
  allows_manual_children, customer_id, is_system, CreateBy, CreateDate
)
SELECT
  @walking_customer_head_code, 'Customer: Walking Customer', 'Customer Receivable',
  @customer_receivable_parent_id, 4, TRUE, TRUE, FALSE, TRUE, 'A', 'ledger',
  FALSE, @walking_customer_id, TRUE, 'Seeding', CURDATE()
WHERE @customer_receivable_parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM account_coa WHERE customer_id = @walking_customer_id
  );
