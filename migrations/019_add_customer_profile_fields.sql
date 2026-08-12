ALTER TABLE customers
  ADD COLUMN first_name VARCHAR(100) NULL AFTER name,
  ADD COLUMN last_name VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER email,
  ADD COLUMN gender ENUM('male', 'female', 'other') NULL AFTER password_hash,
  ADD COLUMN date_of_birth DATE NULL AFTER gender,
  ADD COLUMN image_url VARCHAR(500) NULL AFTER date_of_birth;
