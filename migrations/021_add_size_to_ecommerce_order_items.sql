ALTER TABLE ecommerce_order_items
  ADD COLUMN size_id BIGINT UNSIGNED NULL AFTER product_id,
  ADD KEY ecommerce_order_items_size_index (size_id),
  ADD CONSTRAINT ecommerce_order_items_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE SET NULL;
