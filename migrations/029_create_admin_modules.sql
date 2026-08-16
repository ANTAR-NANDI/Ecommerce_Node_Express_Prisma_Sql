CREATE TABLE admin_modules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_key VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY admin_modules_key_unique (module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_modules (
  role_id BIGINT UNSIGNED NOT NULL,
  module_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, module_id),
  CONSTRAINT role_modules_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT role_modules_module_fk FOREIGN KEY (module_id) REFERENCES admin_modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_modules (module_key, name, description) VALUES
  ('dashboard', 'Dashboard', 'Admin dashboard'),
  ('categories', 'Categories', 'Category management'),
  ('subcategories', 'Subcategories', 'Subcategory management'),
  ('brands', 'Brands', 'Brand management'),
  ('colors', 'Colors', 'Color management'),
  ('sizes', 'Sizes', 'Size management'),
  ('units', 'Units', 'Unit management'),
  ('products', 'Products', 'Product management'),
  ('suppliers', 'Suppliers', 'Supplier management'),
  ('warehouses', 'Warehouses', 'Warehouse management'),
  ('purchases', 'Purchases', 'Purchase management'),
  ('purchase-returns', 'Purchase Returns', 'Purchase return management'),
  ('warehouse-requisitions', 'Warehouse Requisitions', 'Warehouse requisition management'),
  ('warehouse-transfers', 'Warehouse Transfers', 'Warehouse transfer management'),
  ('stock-adjustments', 'Stock Adjustments', 'Stock adjustment management'),
  ('stock-reports', 'Stock Reports', 'Stock reporting'),
  ('pos-sales', 'POS Sales', 'Point of sale management'),
  ('sales-returns', 'Sales Returns', 'Sales return management'),
  ('customers', 'Customers', 'Customer management'),
  ('orders', 'Orders', 'Order management'),
  ('blogs', 'Blogs', 'Blog management'),
  ('flash-sales', 'Flash Sales', 'Flash sale management'),
  ('banners', 'Banners', 'Banner management'),
  ('ad-campaigns', 'Ad Campaigns', 'Advertisement campaign management'),
  ('promo-codes', 'Promo Codes', 'Promo code management'),
  ('employees', 'Employees', 'Employee management'),
  ('roles', 'Roles & Permissions', 'Role and permission management'),
  ('contact-messages', 'Contact Messages', 'Contact message management');
