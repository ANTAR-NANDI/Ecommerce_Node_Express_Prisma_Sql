ALTER TABLE subcategories
  ADD COLUMN description TEXT NULL AFTER image_url;

CREATE TABLE subcategory_categories (
  subcategory_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (subcategory_id, category_id),
  KEY subcategory_categories_category_index (category_id),
  CONSTRAINT subcategory_categories_subcategory_fk FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE,
  CONSTRAINT subcategory_categories_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subcategory_categories (subcategory_id, category_id)
SELECT id, category_id FROM subcategories;
