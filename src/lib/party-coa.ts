import { db } from "../config/db";

type PartyType = "customer" | "supplier" | "employee";
const config: Record<PartyType, { parentCode: number; headType: string; parentName: string; field: string }> = {
  customer: { parentCode: 1000109, headType: "A", parentName: "Customer Receivable", field: "customer_id" },
  supplier: { parentCode: 2000101, headType: "L", parentName: "Supplier Payable", field: "supplier_id" },
  employee: { parentCode: 2000102, headType: "L", parentName: "Salaries Payable", field: "employee_id" },
};

export async function createPartyCoa(type: PartyType, partyId: number, partyName: string, connection: any = db) {
  const item = config[type];
  const [existing] = await connection.execute(`SELECT id, HeadCode FROM account_coa WHERE ${item.field} = ?`, [partyId]) as [any[]];
  if (existing[0]) return existing[0];
  const [parents] = await connection.execute("SELECT id FROM account_coa WHERE HeadCode = ?", [item.parentCode]) as [any[]];
  if (!parents[0]) throw new Error(`Required COA control head ${item.parentCode} is missing`);
  const [last] = await connection.execute("SELECT HeadCode FROM account_coa WHERE parent_id = ? ORDER BY HeadCode DESC LIMIT 1", [parents[0].id]) as [any[]];
  const headCode = last[0] ? Number(last[0].HeadCode) + 1 : item.parentCode * 100 + 1;
  const [result] = await connection.execute(`INSERT INTO account_coa (HeadCode, HeadName, PHeadName, parent_id, HeadLevel, IsActive, IsTransaction, IsGL, IsJournal, HeadType, node_type, allows_manual_children, ${item.field}, CreateBy, CreateDate) VALUES (?, ?, ?, ?, 4, TRUE, TRUE, FALSE, TRUE, ?, 'ledger', FALSE, ?, 'System', CURDATE())`, [headCode, `${type.charAt(0).toUpperCase()}${type.slice(1)}: ${partyName}`, item.parentName, parents[0].id, item.headType, partyId]) as [any];
  return { id: result.insertId, HeadCode: headCode };
}
