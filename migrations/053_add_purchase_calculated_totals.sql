ALTER TABLE purchases
  ADD COLUMN item_discount_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER subtotal,
  ADD COLUMN grand_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount,
  ADD COLUMN due_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER paid_amount;

UPDATE purchases p
LEFT JOIN (
  SELECT purchase_id,
    COALESCE(SUM(quantity * unit_price), 0) AS gross_total,
    COALESCE(SUM(discount), 0) AS item_discount_total,
    COALESCE(SUM(line_total), 0) AS product_total
  FROM purchase_items
  GROUP BY purchase_id
) pi ON pi.purchase_id = p.id
SET p.item_discount_total = COALESCE(pi.item_discount_total, 0),
    p.grand_total = p.total_amount,
    p.due_amount = GREATEST(p.total_amount - p.paid_amount, 0),
    p.subtotal = COALESCE(pi.gross_total, p.subtotal),
    p.total_amount = COALESCE(pi.product_total, p.subtotal);
