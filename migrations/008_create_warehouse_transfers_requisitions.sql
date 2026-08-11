ALTER TABLE stock_movements
  MODIFY movement_type ENUM('purchase', 'purchase_cancel', 'purchase_return', 'purchase_return_cancel', 'transfer_out', 'transfer_in', 'transfer_cancel') NOT NULL;

CREATE TABLE warehouse_requisitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requisition_number VARCHAR(50) NOT NULL,
  requesting_warehouse_id BIGINT UNSIGNED NOT NULL,
  source_warehouse_id BIGINT UNSIGNED NOT NULL,
  note VARCHAR(1000) NULL,
  status ENUM('pending', 'approved', 'rejected', 'processing', 'fulfilled', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_requisitions_number_unique (requisition_number),
  CONSTRAINT requisitions_requesting_warehouse_fk FOREIGN KEY (requesting_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT requisitions_source_warehouse_fk FOREIGN KEY (source_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE warehouse_requisition_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requisition_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY requisition_items_requisition_index (requisition_id),
  CONSTRAINT requisition_items_requisition_fk FOREIGN KEY (requisition_id) REFERENCES warehouse_requisitions(id) ON DELETE CASCADE,
  CONSTRAINT requisition_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE warehouse_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transfer_number VARCHAR(50) NOT NULL,
  from_warehouse_id BIGINT UNSIGNED NOT NULL,
  to_warehouse_id BIGINT UNSIGNED NOT NULL,
  requisition_id BIGINT UNSIGNED NULL,
  note VARCHAR(1000) NULL,
  status ENUM('draft', 'shipped', 'received', 'cancelled') NOT NULL DEFAULT 'draft',
  shipped_at DATETIME NULL,
  received_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_transfers_number_unique (transfer_number),
  KEY transfers_from_warehouse_index (from_warehouse_id),
  KEY transfers_to_warehouse_index (to_warehouse_id),
  CONSTRAINT transfers_from_warehouse_fk FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT transfers_to_warehouse_fk FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  CONSTRAINT transfers_requisition_fk FOREIGN KEY (requisition_id) REFERENCES warehouse_requisitions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE warehouse_transfer_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transfer_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY transfer_items_transfer_index (transfer_id),
  CONSTRAINT transfer_items_transfer_fk FOREIGN KEY (transfer_id) REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
  CONSTRAINT transfer_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
