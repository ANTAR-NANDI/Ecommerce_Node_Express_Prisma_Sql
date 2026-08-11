ALTER TABLE stock_movements
  MODIFY movement_type ENUM('purchase', 'purchase_cancel', 'purchase_return', 'purchase_return_cancel', 'transfer_out', 'transfer_in', 'transfer_cancel', 'adjustment', 'adjustment_cancel', 'pos_sale', 'pos_sale_cancel') NOT NULL;

CREATE TABLE pos_sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_number VARCHAR(50) NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  sale_date DATETIME NOT NULL,
  payment_method ENUM('cash', 'card', 'mobile_banking', 'bank_transfer') NOT NULL,
  note VARCHAR(1000) NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) NOT NULL,
  change_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('completed', 'cancelled') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY pos_sales_number_unique (sale_number),
  KEY pos_sales_warehouse_index (warehouse_id),
  KEY pos_sales_customer_index (customer_id),
  CONSTRAINT pos_sales_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT pos_sales_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pos_sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pos_sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY pos_sale_items_sale_index (pos_sale_id),
  CONSTRAINT pos_sale_items_sale_fk FOREIGN KEY (pos_sale_id) REFERENCES pos_sales(id) ON DELETE CASCADE,
  CONSTRAINT pos_sale_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
