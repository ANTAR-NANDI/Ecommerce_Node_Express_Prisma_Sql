-- Upgrade existing promotion tables to the current API schema.
SET @flash_has_old_dates := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'flash_sales' AND column_name = 'starts_at'
);
SET @sql := IF(@flash_has_old_dates = 1,
  'ALTER TABLE flash_sales DROP INDEX flash_sales_active_dates_index, ADD COLUMN start_date DATE NULL AFTER minimum_discount, ADD COLUMN start_time TIME NULL AFTER start_date, ADD COLUMN end_date DATE NULL AFTER start_time, ADD COLUMN end_time TIME NULL AFTER end_date',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
SET @sql := IF(@flash_has_old_dates = 1,
  'UPDATE flash_sales SET start_date = DATE(starts_at), start_time = TIME(starts_at), end_date = DATE(ends_at), end_time = TIME(ends_at)',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
SET @sql := IF(@flash_has_old_dates = 1,
  'ALTER TABLE flash_sales MODIFY COLUMN start_date DATE NOT NULL, MODIFY COLUMN start_time TIME NOT NULL, MODIFY COLUMN end_date DATE NOT NULL, MODIFY COLUMN end_time TIME NOT NULL, DROP COLUMN starts_at, DROP COLUMN ends_at, ADD KEY flash_sales_active_dates_index (is_active, start_date, end_date)',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @promo_has_old_dates := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'promo_codes' AND column_name = 'starts_at'
);
SET @sql := IF(@promo_has_old_dates = 1,
  'ALTER TABLE promo_codes DROP INDEX promo_codes_active_dates_index, ADD COLUMN start_date DATE NULL AFTER maximum_discount_amount, ADD COLUMN start_time TIME NULL AFTER start_date, ADD COLUMN end_date DATE NULL AFTER start_time, ADD COLUMN end_time TIME NULL AFTER end_date',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
SET @sql := IF(@promo_has_old_dates = 1,
  'UPDATE promo_codes SET start_date = DATE(starts_at), start_time = TIME(starts_at), end_date = DATE(expires_at), end_time = TIME(expires_at)',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
SET @sql := IF(@promo_has_old_dates = 1,
  'ALTER TABLE promo_codes MODIFY COLUMN start_date DATE NOT NULL, MODIFY COLUMN start_time TIME NOT NULL, MODIFY COLUMN end_date DATE NOT NULL, MODIFY COLUMN end_time TIME NOT NULL, DROP COLUMN starts_at, DROP COLUMN expires_at, ADD KEY promo_codes_active_dates_index (is_active, start_date, end_date)',
  'SELECT 1');
PREPARE migration_statement FROM @sql;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

ALTER TABLE banners MODIFY COLUMN is_own_shop BOOLEAN NULL DEFAULT NULL;
