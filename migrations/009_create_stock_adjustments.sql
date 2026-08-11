ALTER TABLE stock_movements
  MODIFY movement_type ENUM('purchase', 'purchase_cancel', 'purchase_return', 'purchase_return_cancel', 'transfer_out', 'transfer_in', 'transfer_cancel', 'adjustment', 'adjustment_cancel') NOT NULL;

CREATE TABLE stock_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  adjustment_number VARCHAR(50) NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  adjustment_date DATE NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('completed', 'cancelled') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY stock_adjustments_number_unique (adjustment_number),
  KEY stock_adjustments_warehouse_index (warehouse_id),
  CONSTRAINT stock_adjustments_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_adjustment_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stock_adjustment_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity_change INT NOT NULL,
  note VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY adjustment_items_adjustment_index (stock_adjustment_id),
  CONSTRAINT adjustment_items_adjustment_fk FOREIGN KEY (stock_adjustment_id) REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  CONSTRAINT adjustment_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
