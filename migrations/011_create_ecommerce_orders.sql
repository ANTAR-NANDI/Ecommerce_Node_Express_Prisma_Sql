ALTER TABLE stock_movements
  MODIFY movement_type ENUM('purchase', 'purchase_cancel', 'purchase_return', 'purchase_return_cancel', 'transfer_out', 'transfer_in', 'transfer_cancel', 'adjustment', 'adjustment_cancel', 'pos_sale', 'pos_sale_cancel', 'ecommerce_order', 'ecommerce_order_cancel') NOT NULL;

CREATE TABLE ecommerce_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number VARCHAR(50) NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  order_date DATETIME NOT NULL,
  status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
  payment_method ENUM('cod', 'card', 'mobile_banking', 'bank_transfer') NOT NULL,
  payment_status ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  shipping_address TEXT NOT NULL,
  note VARCHAR(1000) NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ecommerce_orders_number_unique (order_number),
  KEY ecommerce_orders_warehouse_index (warehouse_id),
  KEY ecommerce_orders_customer_index (customer_id),
  KEY ecommerce_orders_status_index (status),
  CONSTRAINT ecommerce_orders_warehouse_fk FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT ecommerce_orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ecommerce_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ecommerce_order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ecommerce_order_items_order_index (ecommerce_order_id),
  CONSTRAINT ecommerce_order_items_order_fk FOREIGN KEY (ecommerce_order_id) REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
  CONSTRAINT ecommerce_order_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
