import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";

export const reportsRouter = Router();

const id = z.coerce.number().int().positive();
const reportQuery = z.object({
  productId: id.optional(),
  warehouseId: id.optional(),
  customerId: id.optional(),
  supplierId: id.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

function parseQuery(query: unknown) {
  const parsed = reportQuery.parse(query);
  if (parsed.dateFrom && parsed.dateTo && parsed.dateFrom > parsed.dateTo) {
    throw new HttpError(400, "dateFrom must be on or before dateTo");
  }
  return parsed;
}

function totals(rows: any[], balanceSign = 1) {
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.debit), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.credit), 0);
  return { totalDebit, totalCredit, balance: Number(((totalDebit - totalCredit) * balanceSign).toFixed(2)) };
}

// Product movements are the stock source of truth. The opening/closing quantities make
// the selected date range useful, while currentQuantity exposes the live warehouse balance.
reportsRouter.get("/stock", asyncHandler(async (req, res) => {
  const query = parseQuery(req.query);
  const filters: string[] = []; const values: Array<number | string> = [];
  if (query.warehouseId) { filters.push("sm.warehouse_id = ?"); values.push(query.warehouseId); }
  if (query.productId) { filters.push("sm.product_id = ?"); values.push(query.productId); }
  const periodFilters = [...filters]; const periodValues = [...values];
  if (query.dateFrom) { periodFilters.push("DATE(sm.created_at) >= ?"); periodValues.push(query.dateFrom); }
  if (query.dateTo) { periodFilters.push("DATE(sm.created_at) <= ?"); periodValues.push(query.dateTo); }
  const openingFilters = [...filters]; const openingValues = [...values];
  if (query.dateFrom) { openingFilters.push("DATE(sm.created_at) < ?"); openingValues.push(query.dateFrom); }

  const [rows] = await db.execute<any[]>(
    `SELECT sm.warehouse_id AS warehouseId, w.name AS warehouseName, sm.product_id AS productId,
      p.name AS productName, p.sku, COALESCE(opening.quantity, 0) AS openingQuantity,
      COALESCE(period.quantity, 0) AS movementQuantity, COALESCE(opening.quantity, 0) + COALESCE(period.quantity, 0) AS closingQuantity,
      COALESCE(ws.quantity, 0) AS currentQuantity
     FROM (
       SELECT DISTINCT warehouse_id, product_id FROM stock_movements
       ${periodFilters.length ? `WHERE ${periodFilters.join(" AND ")}` : ""}
     ) selected
     JOIN warehouses w ON w.id = selected.warehouse_id
     JOIN products p ON p.id = selected.product_id
     LEFT JOIN warehouse_stocks ws ON ws.warehouse_id = selected.warehouse_id AND ws.product_id = selected.product_id
     LEFT JOIN (
       SELECT sm.warehouse_id, sm.product_id, SUM(sm.quantity_change) AS quantity
       FROM stock_movements sm ${openingFilters.length ? `WHERE ${openingFilters.join(" AND ")}` : ""}
       GROUP BY sm.warehouse_id, sm.product_id
     ) opening ON opening.warehouse_id = selected.warehouse_id AND opening.product_id = selected.product_id
     LEFT JOIN (
       SELECT sm.warehouse_id, sm.product_id, SUM(sm.quantity_change) AS quantity
       FROM stock_movements sm ${periodFilters.length ? `WHERE ${periodFilters.join(" AND ")}` : ""}
       GROUP BY sm.warehouse_id, sm.product_id
     ) period ON period.warehouse_id = selected.warehouse_id AND period.product_id = selected.product_id
     ORDER BY w.name, p.name`,
    [...periodValues, ...openingValues, ...periodValues],
  );
  res.json({ success: true, filters: query, summary: { rows: rows.length, currentQuantity: rows.reduce((sum, row) => sum + Number(row.currentQuantity), 0) }, data: rows });
}));

reportsRouter.get("/sales", asyncHandler(async (req, res) => {
  const query = parseQuery(req.query);
  const filters = ["ps.status = 'completed'"]; const values: Array<number | string> = [];
  if (query.customerId) { filters.push("ps.customer_id = ?"); values.push(query.customerId); }
  if (query.productId) { filters.push("psi.product_id = ?"); values.push(query.productId); }
  if (query.dateFrom) { filters.push("DATE(ps.sale_date) >= ?"); values.push(query.dateFrom); }
  if (query.dateTo) { filters.push("DATE(ps.sale_date) <= ?"); values.push(query.dateTo); }
  const [rows] = await db.execute<any[]>(
    `SELECT ps.id AS saleId, ps.sale_number AS saleNumber, ps.sale_date AS saleDate, ps.customer_id AS customerId,
      COALESCE(c.name, 'Guest customer') AS customerName, c.is_walk_in AS isWalkIn, ps.warehouse_id AS warehouseId,
      w.name AS warehouseName, psi.product_id AS productId, p.name AS productName, p.sku, psi.quantity,
      psi.unit_price AS unitPrice, psi.discount AS itemDiscount, psi.line_total AS lineTotal
     FROM pos_sales ps JOIN pos_sale_items psi ON psi.pos_sale_id = ps.id JOIN products p ON p.id = psi.product_id
     JOIN warehouses w ON w.id = ps.warehouse_id LEFT JOIN customers c ON c.id = ps.customer_id
     WHERE ${filters.join(" AND ")} ORDER BY ps.sale_date DESC, ps.id DESC, psi.id`, values);
  const saleIds = new Set(rows.map(row => row.saleId));
  res.json({ success: true, filters: query, summary: { sales: saleIds.size, quantity: rows.reduce((sum, row) => sum + Number(row.quantity), 0), netSales: rows.reduce((sum, row) => sum + Number(row.lineTotal), 0) }, data: rows });
}));

reportsRouter.get("/purchases", asyncHandler(async (req, res) => {
  const query = parseQuery(req.query);
  const filters = ["pu.status = 'received'"]; const values: Array<number | string> = [];
  if (query.supplierId) { filters.push("pu.supplier_id = ?"); values.push(query.supplierId); }
  if (query.productId) { filters.push("pi.product_id = ?"); values.push(query.productId); }
  if (query.dateFrom) { filters.push("pu.purchase_date >= ?"); values.push(query.dateFrom); }
  if (query.dateTo) { filters.push("pu.purchase_date <= ?"); values.push(query.dateTo); }
  const [rows] = await db.execute<any[]>(
    `SELECT pu.id AS purchaseId, pu.purchase_number AS purchaseNumber, pu.purchase_date AS purchaseDate,
      pu.invoice_number AS invoiceNumber, pu.supplier_id AS supplierId, s.name AS supplierName,
      pu.warehouse_id AS warehouseId, w.name AS warehouseName, pi.product_id AS productId, p.name AS productName,
      p.sku, pi.quantity, pi.unit_price AS unitPrice, pi.discount AS itemDiscount, pi.line_total AS lineTotal
     FROM purchases pu JOIN purchase_items pi ON pi.purchase_id = pu.id JOIN products p ON p.id = pi.product_id
     JOIN suppliers s ON s.id = pu.supplier_id JOIN warehouses w ON w.id = pu.warehouse_id
     WHERE ${filters.join(" AND ")} ORDER BY pu.purchase_date DESC, pu.id DESC, pi.id`, values);
  const purchaseIds = new Set(rows.map(row => row.purchaseId));
  res.json({ success: true, filters: query, summary: { purchases: purchaseIds.size, quantity: rows.reduce((sum, row) => sum + Number(row.quantity), 0), netPurchases: rows.reduce((sum, row) => sum + Number(row.lineTotal), 0) }, data: rows });
}));

async function partyLedger(req: any, res: any, type: "customer" | "supplier") {
  const query = parseQuery(req.query); const partyId = type === "customer" ? query.customerId : query.supplierId;
  if (!partyId) throw new HttpError(400, `${type}Id is required`);
  const partyTable = type === "customer" ? "customers" : "suppliers";
  const partyField = type === "customer" ? "customer_id" : "supplier_id";
  const [parties] = await db.execute<any[]>(`SELECT p.id, p.name, coa.HeadCode AS headCode FROM ${partyTable} p JOIN account_coa coa ON coa.${partyField} = p.id WHERE p.id = ?`, [partyId]);
  const party = parties[0]; if (!party) throw new HttpError(404, `${type === "customer" ? "Customer" : "Supplier"} or its ledger head was not found`);
  const priorFilters = ["head_code = ?"]; const priorValues: Array<number | string> = [party.headCode];
  if (query.dateFrom) { priorFilters.push("DATE(transaction_date) < ?"); priorValues.push(query.dateFrom); }
  const rangeFilters = ["head_code = ?"]; const rangeValues: Array<number | string> = [party.headCode];
  if (query.dateFrom) { rangeFilters.push("DATE(transaction_date) >= ?"); rangeValues.push(query.dateFrom); }
  if (query.dateTo) { rangeFilters.push("DATE(transaction_date) <= ?"); rangeValues.push(query.dateTo); }
  const [openingRows] = await db.execute<any[]>(`SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit FROM account_transactions WHERE ${priorFilters.join(" AND ")}`, priorValues);
  const [entries] = await db.execute<any[]>(`SELECT id, transaction_no AS transactionNo, transaction_date AS transactionDate, debit, credit, reference_type AS referenceType, reference_id AS referenceId, description FROM account_transactions WHERE ${rangeFilters.join(" AND ")} ORDER BY transaction_date, id`, rangeValues);
  let runningBalance = (Number(openingRows[0].debit) - Number(openingRows[0].credit)) * (type === "supplier" ? -1 : 1);
  const data = entries.map(entry => { runningBalance += (Number(entry.debit) - Number(entry.credit)) * (type === "supplier" ? -1 : 1); return { ...entry, runningBalance: Number(runningBalance.toFixed(2)) }; });
  const summary = totals(entries, type === "supplier" ? -1 : 1);
  const openingBalance = Number((((Number(openingRows[0].debit) - Number(openingRows[0].credit)) * (type === "supplier" ? -1 : 1)).toFixed(2)));
  res.json({ success: true, filters: query, party: { id: party.id, name: party.name, headCode: party.headCode }, openingBalance, summary: { ...summary, closingBalance: data.length ? data[data.length - 1].runningBalance : openingBalance }, data });
}

reportsRouter.get("/supplier-ledger", asyncHandler(async (req, res) => partyLedger(req, res, "supplier")));
reportsRouter.get("/customer-ledger", asyncHandler(async (req, res) => partyLedger(req, res, "customer")));
