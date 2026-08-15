CREATE TABLE blogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  tags JSON NOT NULL,
  description TEXT NOT NULL,
  image VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY blogs_slug_unique (slug),
  KEY blogs_category_id_index (category_id), KEY blogs_active_created_index (is_active, created_at),
  CONSTRAINT blogs_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
