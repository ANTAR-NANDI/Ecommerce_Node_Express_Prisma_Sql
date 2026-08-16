-- One accounting journal contains multiple debit/credit lines with the same transaction number.
SET @has_old_index := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'account_transactions' AND index_name = 'account_transactions_number_unique');
SET @fix_sql := IF(@has_old_index > 0, 'ALTER TABLE account_transactions DROP INDEX account_transactions_number_unique, ADD KEY account_transactions_number_index (transaction_no)', 'SELECT 1');
PREPARE fix_statement FROM @fix_sql;
EXECUTE fix_statement;
DEALLOCATE PREPARE fix_statement;
