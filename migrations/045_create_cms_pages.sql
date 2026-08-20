CREATE TABLE cms_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  seo_title VARCHAR(255) NULL,
  seo_description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY cms_pages_slug_unique (slug),
  KEY cms_pages_active_index (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cms_pages (title, slug, content, seo_title, seo_description, is_active) VALUES
('About Us', 'about-us', '<h1>About Us</h1><p>Write your company story here.</p>', 'About Us', 'Learn about our company.', TRUE),
('Privacy Policy', 'privacy-policy', '<h1>Privacy Policy</h1><p>Write your privacy policy here.</p>', 'Privacy Policy', 'Our privacy policy.', TRUE),
('Terms & Conditions', 'terms-and-conditions', '<h1>Terms & Conditions</h1><p>Write your terms and conditions here.</p>', 'Terms & Conditions', 'Our terms and conditions.', TRUE),
('Return & Refund Policy', 'return-and-refund-policy', '<h1>Return & Refund Policy</h1><p>Write your return and refund policy here.</p>', 'Return & Refund Policy', 'Our return and refund policy.', TRUE),
('Shipping & Delivery Policy', 'shipping-and-delivery-policy', '<h1>Shipping & Delivery Policy</h1><p>Write your shipping and delivery policy here.</p>', 'Shipping & Delivery Policy', 'Our shipping and delivery policy.', TRUE)
ON DUPLICATE KEY UPDATE title = VALUES(title);
