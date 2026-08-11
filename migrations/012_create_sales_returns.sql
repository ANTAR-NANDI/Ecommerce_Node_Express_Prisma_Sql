ALTER TABLE stock_movements
  MODIFY movement_type ENUM('purchase', 'purchase_cancel', 'purchase_return', 'purchase_return_cancel', 'transfer_out', 'transfer_in', 'transfer_cancel', 'adjustment', 'adjustment_cancel', 'pos_sale', 'pos_sale_cancel', 'ecommerce_order', 'ecommerce_order_cancel', 'sales_return', 'sales_return_cancel') NOT NULL;

CREATE TABLE sales_returns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  return_number VARCHAR(50) NOT NULL,
  source_type ENUM('pos_sale', 'ecommerce_order') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  return_date DATE NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('completed', 'cancelled') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY sales_returns_number_unique (return_number),
  KEY sales_returns_source_index (source_type, source_id),
  KEY sales_returns_warehouse_index (warehouse_id),
  CONSTRAINT sales_returns_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT sales_returns_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sales_return_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sales_return_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY sales_return_items_return_index (sales_return_id),
  CONSTRAINT sales_return_items_return_fk FOREIGN KEY (sales_return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  CONSTRAINT sales_return_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
