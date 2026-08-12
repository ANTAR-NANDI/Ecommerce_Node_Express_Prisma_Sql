CREATE TABLE product_subcategories (
  product_id BIGINT UNSIGNED NOT NULL,
  subcategory_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (product_id, subcategory_id),
  KEY product_subcategories_subcategory_index (subcategory_id),
  CONSTRAINT product_subcategories_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT product_subcategories_subcategory_fk FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO product_subcategories (product_id, subcategory_id)
SELECT id, subcategory_id FROM products WHERE subcategory_id IS NOT NULL;
