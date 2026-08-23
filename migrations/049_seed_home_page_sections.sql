INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'hero', 'Welcome to Ready Ecommerce', JSON_OBJECT('heading', 'Shop the latest collection', 'subheading', 'Best products at the best price', 'buttonText', 'Shop Now', 'buttonUrl', '/products'), 1, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'hero');

INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'category_grid', 'Shop by Category', JSON_OBJECT('limit', 12, 'columns', 6), 2, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'category_grid');

INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'product_grid', 'Featured Products', JSON_OBJECT('source', 'featured', 'limit', 12, 'columns', 4, 'showViewAll', TRUE, 'viewAllUrl', '/products'), 3, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'product_grid');

INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'flash_sale', 'Flash Deals', JSON_OBJECT('limit', 8), 4, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'flash_sale');

INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'brand_slider', 'Popular Brands', JSON_OBJECT('limit', 12), 5, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'brand_slider');

INSERT INTO cms_page_sections (page_id, section_type, title, settings, sort_order, is_active)
SELECT id, 'blog_list', 'Latest From Our Blog', JSON_OBJECT('limit', 6, 'columns', 3), 6, TRUE
FROM cms_pages p WHERE p.slug = 'home' AND NOT EXISTS (SELECT 1 FROM cms_page_sections s WHERE s.page_id = p.id AND s.section_type = 'blog_list');
