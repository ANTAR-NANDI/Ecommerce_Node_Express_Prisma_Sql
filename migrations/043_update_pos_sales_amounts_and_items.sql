ALTER TABLE pos_sales
  MODIFY COLUMN payment_method ENUM('cash', 'card', 'mobile_banking', 'bank_transfer', 'transfer', 'cheque') NOT NULL,
  ADD COLUMN grand_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount,
  ADD COLUMN due_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER paid_amount;

ALTER TABLE pos_sale_items
  ADD COLUMN size_id BIGINT UNSIGNED NULL AFTER product_id,
  ADD COLUMN color_id BIGINT UNSIGNED NULL AFTER size_id,
  ADD KEY pos_sale_items_size_index (size_id),
  ADD KEY pos_sale_items_color_index (color_id),
  ADD CONSTRAINT pos_sale_items_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE SET NULL,
  ADD CONSTRAINT pos_sale_items_color_fk FOREIGN KEY (color_id) REFERENCES colors(id) ON DELETE SET NULL;

UPDATE pos_sales
SET grand_total = total_amount,
    due_amount = CASE WHEN paid_amount < total_amount THEN total_amount - paid_amount ELSE 0 END
WHERE grand_total = 0 AND total_amount > 0;
