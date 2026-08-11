-- Keep the old `shipped` value temporarily so existing production rows can be converted safely.
ALTER TABLE ecommerce_orders
  MODIFY status ENUM('pending', 'confirmed', 'processing', 'shipped', 'pickup', 'on_the_way', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending';

UPDATE ecommerce_orders SET status = 'on_the_way' WHERE status = 'shipped';

ALTER TABLE ecommerce_orders
  MODIFY status ENUM('pending', 'confirmed', 'processing', 'pickup', 'on_the_way', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending';

CREATE TABLE product_favorites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY product_favorites_customer_product_unique (customer_id, product_id),
  KEY product_favorites_product_index (product_id),
  CONSTRAINT product_favorites_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT product_favorites_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
