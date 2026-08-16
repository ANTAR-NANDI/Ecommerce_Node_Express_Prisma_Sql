CREATE TABLE supplier_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, payment_number VARCHAR(60) NOT NULL, supplier_id BIGINT UNSIGNED NOT NULL,
  payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, amount DECIMAL(15,2) NOT NULL, payment_method VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), UNIQUE KEY supplier_payments_number_unique(payment_number),
  KEY supplier_payments_supplier_index(supplier_id), CONSTRAINT supplier_payments_supplier_fk FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE employee_salary_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, payment_number VARCHAR(60) NOT NULL, employee_id BIGINT UNSIGNED NOT NULL,
  payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, amount DECIMAL(15,2) NOT NULL, payment_method VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id), UNIQUE KEY employee_salary_payments_number_unique(payment_number),
  KEY employee_salary_payments_employee_index(employee_id), CONSTRAINT employee_salary_payments_employee_fk FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
