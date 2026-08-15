-- MySQL auto-commits ALTER TABLE. These guards let this migration resume if an
-- earlier deployment stopped after the temporary column was added.
SET @has_temp_column := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'blogs' AND column_name = 'category_id'
);
SET @category_is_numeric := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'blogs' AND column_name = 'category'
    AND data_type IN ('tinyint', 'smallint', 'mediumint', 'int', 'bigint')
);
SET @sql := IF(@has_temp_column = 0 AND @category_is_numeric = 0,
  'ALTER TABLE blogs ADD COLUMN category_id BIGINT UNSIGNED NULL AFTER slug',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

-- Convert existing category names (or numeric strings) to category IDs.
SET @sql := IF(@has_temp_column = 1 OR @category_is_numeric = 0,
  'UPDATE blogs b LEFT JOIN categories c ON c.name = b.category SET b.category_id = COALESCE(c.id, CAST(b.category AS UNSIGNED)) WHERE b.category_id IS NULL',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @sql := IF(@has_temp_column = 1 OR @category_is_numeric = 0,
  'ALTER TABLE blogs DROP INDEX blogs_category_index, DROP COLUMN category, CHANGE COLUMN category_id category BIGINT UNSIGNED NOT NULL, ADD KEY blogs_category_index (category), ADD CONSTRAINT blogs_category_fk FOREIGN KEY (category) REFERENCES categories(id) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
