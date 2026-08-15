ALTER TABLE blogs ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER slug;

-- Existing category names are converted where they match a category name.
UPDATE blogs b
JOIN categories c ON c.name = b.category
SET b.category_id = c.id;

ALTER TABLE blogs
  DROP INDEX blogs_category_index,
  DROP COLUMN category,
  CHANGE COLUMN category_id category BIGINT UNSIGNED NOT NULL,
  ADD KEY blogs_category_index (category),
  ADD CONSTRAINT blogs_category_fk FOREIGN KEY (category) REFERENCES categories(id) ON DELETE RESTRICT;
