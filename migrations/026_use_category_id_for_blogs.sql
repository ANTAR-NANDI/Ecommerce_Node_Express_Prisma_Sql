-- MySQL auto-commits ALTER TABLE. These guards let this migration resume if an
-- earlier deployment stopped after category_id was added.
SET @has_temp_column := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'blogs' AND column_name = 'category_id'
);
SET @sql := IF(@has_temp_column = 0,
  'ALTER TABLE blogs ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER slug',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @has_temp_column := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'blogs' AND column_name = 'category_id'
);

-- Convert legacy category names only by matching categories.name; never cast a
-- name such as "Technology" to an integer.
SET @sql := IF(@has_temp_column = 1,
  'UPDATE blogs b JOIN categories c ON c.name = b.category SET b.category_id = c.id WHERE b.category_id IS NULL',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @sql := IF(@has_temp_column = 1,
  'ALTER TABLE blogs DROP INDEX blogs_category_index, DROP COLUMN category, MODIFY COLUMN category_id BIGINT UNSIGNED NOT NULL, ADD KEY blogs_category_id_index (category_id), ADD CONSTRAINT blogs_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
