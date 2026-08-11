ALTER TABLE users
  MODIFY role ENUM('admin', 'employee', 'customer') NOT NULL DEFAULT 'customer';

CREATE TABLE employees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NULL,
  phone VARCHAR(30) NOT NULL,
  gender ENUM('male', 'female', 'other') NULL,
  image_url VARCHAR(255) NULL,
  employee_role VARCHAR(100) NOT NULL DEFAULT 'staff',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY employees_user_unique (user_id),
  UNIQUE KEY employees_phone_unique (phone),
  KEY employees_role_index (employee_role),
  CONSTRAINT employees_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
