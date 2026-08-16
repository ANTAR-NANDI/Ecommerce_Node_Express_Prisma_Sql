CREATE TABLE roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY roles_name_unique (name), UNIQUE KEY roles_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  permission_key VARCHAR(150) NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  action_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY permissions_key_unique (permission_key), KEY permissions_module_index (module_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (name, slug, description, is_system) VALUES
  ('Root', 'root', 'Full system access', TRUE),
  ('Admin', 'admin', 'Administrator access', TRUE),
  ('Supplier', 'supplier', 'Supplier operations', FALSE),
  ('Visitor', 'visitor', 'Read-only access', FALSE);

INSERT INTO permissions (permission_key, module_name, action_name) VALUES
  ('orders.list', 'Orders', 'list'), ('orders.view', 'Orders', 'view details'), ('orders.change_status', 'Orders', 'change status'),
  ('products.list', 'Products', 'list'), ('products.create', 'Products', 'create'), ('products.view', 'Products', 'view details'), ('products.edit', 'Products', 'edit'), ('products.toggle_active', 'Products', 'enable/disable'), ('products.delete', 'Products', 'delete'), ('products.barcode', 'Products', 'barcode'), ('products.generate_ai_data', 'Products', 'generate AI data'),
  ('flash_sales.list', 'Flash Sale', 'list'), ('flash_sales.view', 'Flash Sale', 'view details'), ('flash_sales.create', 'Flash Sale', 'create'), ('flash_sales.edit', 'Flash Sale', 'edit'), ('flash_sales.delete', 'Flash Sale', 'delete'),
  ('promo_codes.list', 'Promo Code', 'list'), ('promo_codes.create', 'Promo Code', 'create'), ('promo_codes.edit', 'Promo Code', 'edit'), ('promo_codes.toggle_active', 'Promo Code', 'enable/disable'), ('promo_codes.delete', 'Promo Code', 'delete'),
  ('roles.manage', 'Roles & Permissions', 'manage roles and permissions');
