INSERT INTO cms_pages (title, slug, content, seo_title, seo_description, is_active) VALUES
('Home', 'home', '<h1>Home</h1>', 'Ready Ecommerce', 'Shop online with Ready Ecommerce.', TRUE)
ON DUPLICATE KEY UPDATE title = VALUES(title);

CREATE TABLE cms_page_sections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id BIGINT UNSIGNED NOT NULL,
  section_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NULL,
  settings JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cms_page_sections_page_index (page_id, is_active, sort_order),
  CONSTRAINT cms_page_sections_page_fk FOREIGN KEY (page_id) REFERENCES cms_pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
