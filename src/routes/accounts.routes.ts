import { Router } from "express";
import { z } from "zod";
import { db } from "../config/db";
import { asyncHandler } from "../lib/async-handler";
import { HttpError } from "../lib/http-error";

export const accountsRouter = Router();
const id = z.coerce.number().int().positive();
const childInput = z.object({
  parentId: id,
  headName: z.string().trim().min(2).max(100),
  isActive: z.preprocess(value => value === "true" ? true : value === "false" ? false : value, z.boolean()).optional(),
});

const select = `SELECT id, HeadCode AS headCode, HeadName AS name, PHeadName AS parentHeadName, parent_id AS parentId, HeadLevel AS level,
  HeadType AS headType, node_type AS nodeType, allows_manual_children AS allowsManualChildren, IsTransaction AS isTransaction,
  IsGL AS isGl, IsJournal AS isJournal, IsBudget AS isBudget, IsDepreciation AS isDepreciation, customer_id AS customerId,
  aggre_id AS aggreId, supplier_id AS supplierId, employee_id AS employeeId, payment_method_id AS paymentMethodId,
  bank_id AS bankId, is_system AS isSystem, IsActive AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM account_coa`;

function asTree(rows: any[]) {
  const byId = new Map<number, any>();
  const roots: any[] = [];
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}

accountsRouter.get("/coa", asyncHandler(async (_req, res) => {
  const [rows] = await db.query<any[]>(`${select} ORDER BY HeadCode`);
  res.json({ success: true, data: asTree(rows) });
}));

accountsRouter.get("/coa/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Account head not found");
  res.json({ success: true, data: rows[0] });
}));

accountsRouter.post("/coa", asyncHandler(async (req, res) => {
  const input = childInput.parse(req.body);
  const parentId = input.parentId;
  const [parents] = await db.execute<any[]>(`${select} WHERE id = ?`, [parentId]);
  const parent = parents[0];
  if (!parent) throw new HttpError(404, "Parent account head not found");
  if (!parent.allowsManualChildren || parent.level >= 4 || parent.nodeType === "ledger" || parent.nodeType === "control") {
    throw new HttpError(400, "A child account cannot be created below this fixed account level");
  }
  const level = Number(parent.level) + 1;
  const nodeType = level >= 3 ? "ledger" : "group";
  const allowsManualChildren = level < 3;
  const [lastChildren] = await db.execute<any[]>("SELECT HeadCode FROM account_coa WHERE parent_id = ? ORDER BY HeadCode DESC LIMIT 1", [parentId]);
  // A sibling always receives the next sequential head code. If this is the first child,
  // reserve two digits below the parent's code (for example 111 -> 11101).
  const nextHeadCode = lastChildren[0] ? Number(lastChildren[0].HeadCode) + 1 : Number(parent.headCode) * 100 + 1;
  const [result] = await db.execute<any>("INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, HeadType, node_type, allows_manual_children, IsTransaction, IsGL, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [nextHeadCode, input.headName, parent.name, parentId, level, parent.headType, nodeType, allowsManualChildren, nodeType === "ledger", nodeType === "ledger", input.isActive ?? true]);
  const [rows] = await db.execute<any[]>(`${select} WHERE id = ?`, [result.insertId]);
  res.status(201).json({ success: true, data: rows[0] });
}));
