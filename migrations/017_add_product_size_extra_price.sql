ALTER TABLE product_sizes
  ADD COLUMN extra_price DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER size_id;
