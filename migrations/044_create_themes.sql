CREATE TABLE themes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(80) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  thumbnail VARCHAR(2048) NULL,
  settings JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY themes_key_unique (`key`),
  KEY themes_active_index (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO themes (`key`, name, description, thumbnail, settings, is_active) VALUES
(
  'fashion', 'Fashion Store', 'A premium fashion storefront layout', NULL,
  JSON_OBJECT(
    'primaryColor', '#db2777', 'secondaryColor', '#111827', 'fontFamily', 'Inter',
    'announcementText', 'Free delivery on orders over ৳1,000',
    'showFlashSales', TRUE, 'showFeaturedProducts', TRUE,
    'homeSections', JSON_ARRAY('hero', 'categories', 'featured-products', 'flash-sales', 'brands', 'blogs')
  ), TRUE
),
(
  'grocery', 'Grocery Store', 'A fast grocery storefront layout', NULL,
  JSON_OBJECT(
    'primaryColor', '#169b62', 'accentColor', '#f59e0b', 'fontFamily', 'Inter',
    'productCardStyle', 'compact', 'showCategorySidebar', TRUE, 'showQuickAdd', TRUE,
    'homeSections', JSON_ARRAY('hero', 'categories', 'flashDeals', 'popularProducts', 'freshGroceries', 'promotionalBanners')
  ), FALSE
)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), settings = VALUES(settings);
