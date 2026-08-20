CREATE TABLE cms_menus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  location ENUM('header', 'footer') NOT NULL,
  label VARCHAR(150) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  page_id BIGINT UNSIGNED NULL,
  parent_id BIGINT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  open_in_new_tab BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cms_menus_location_index (location, is_active, sort_order),
  KEY cms_menus_page_index (page_id),
  KEY cms_menus_parent_index (parent_id),
  CONSTRAINT cms_menus_page_fk FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE SET NULL,
  CONSTRAINT cms_menus_parent_fk FOREIGN KEY (parent_id) REFERENCES cms_menus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cms_footer (
  id TINYINT UNSIGNED NOT NULL,
  copyright_text VARCHAR(500) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  settings JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cms_footer (id, copyright_text, phone, email, settings) VALUES
(1, '© 2026 Ready Ecommerce. All rights reserved.', NULL, NULL, JSON_OBJECT('columns', JSON_ARRAY(), 'socialLinks', JSON_OBJECT()))
ON DUPLICATE KEY UPDATE id = id;
