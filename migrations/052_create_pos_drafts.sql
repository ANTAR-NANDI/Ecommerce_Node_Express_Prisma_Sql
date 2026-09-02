CREATE TABLE pos_drafts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
  sale_date DATETIME NULL,
  payment_method ENUM('cash','card','mobile_banking','bank_transfer','transfer','cheque') NOT NULL DEFAULT 'cash',
  note VARCHAR(1000) NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY pos_drafts_warehouse_index (warehouse_id),
  KEY pos_drafts_customer_index (customer_id),
  CONSTRAINT pos_drafts_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT pos_drafts_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pos_draft_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pos_draft_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  size_id BIGINT UNSIGNED NULL,
  color_id BIGINT UNSIGNED NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY pos_draft_items_draft_index (pos_draft_id),
  CONSTRAINT pos_draft_items_draft_fk FOREIGN KEY (pos_draft_id) REFERENCES pos_drafts(id) ON DELETE CASCADE,
  CONSTRAINT pos_draft_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT pos_draft_items_size_fk FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE RESTRICT,
  CONSTRAINT pos_draft_items_color_fk FOREIGN KEY (color_id) REFERENCES colors(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
