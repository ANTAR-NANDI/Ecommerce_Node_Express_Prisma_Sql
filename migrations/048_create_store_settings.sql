CREATE TABLE store_settings (
  id TINYINT UNSIGNED NOT NULL,
  store_name VARCHAR(255) NOT NULL,
  logo VARCHAR(2048) NULL,
  favicon VARCHAR(2048) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  address TEXT NULL,
  facebook_url VARCHAR(2048) NULL,
  instagram_url VARCHAR(2048) NULL,
  default_seo_title VARCHAR(255) NULL,
  default_seo_description VARCHAR(500) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO store_settings (id, store_name, default_seo_title, default_seo_description)
VALUES (1, 'Ready Ecommerce', 'Ready Ecommerce', 'Shop online with Ready Ecommerce.')
ON DUPLICATE KEY UPDATE id = id;
