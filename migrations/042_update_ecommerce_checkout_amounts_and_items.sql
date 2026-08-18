-- A customer selects products, not a warehouse.  Warehouse allocation happens
-- later when an administrator confirms the order.
ALTER TABLE ecommerce_orders
  MODIFY COLUMN warehouse_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN payment_method ENUM('cod', 'cash', 'card', 'mobile_banking', 'bank_transfer', 'transfer', 'cheque') NOT NULL,
  ADD COLUMN grand_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount,
  ADD COLUMN paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER grand_total,
  ADD COLUMN due_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER paid_amount;

-- unit_price remains the database price column.  It is exposed by the API as
-- "price" so the frontend has the requested field name.
ALTER TABLE ecommerce_order_items
  ADD COLUMN color_id BIGINT UNSIGNED NULL AFTER size_id,
  ADD KEY ecommerce_order_items_color_index (color_id),
  ADD CONSTRAINT ecommerce_order_items_color_fk FOREIGN KEY (color_id) REFERENCES colors(id) ON DELETE SET NULL;

-- Keep all previously created orders readable.  Their old total_amount was the
-- final payable amount, so it is the best available grand-total value.
UPDATE ecommerce_orders
SET grand_total = total_amount,
    paid_amount = CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END,
    due_amount = CASE WHEN payment_status = 'paid' THEN 0 ELSE total_amount END
WHERE grand_total = 0 AND total_amount > 0;
