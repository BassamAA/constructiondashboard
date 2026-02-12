import apiClient from "./client";

export type ReceivablesHealth = {
  mismatchedReceipts: Array<{
    id: number;
    customerId: number | null;
    total: number;
    storedPaid: number;
    linkedPaid: number;
    storedIsPaid: boolean;
    shouldBePaid: boolean;
    delta: number;
  }>;
  orphanReceiptPayments: Array<{ id: number; receiptId: number | null; paymentId: number | null }>;
  invalidPayments: Array<{ id: number; type: string; customerId: number | null; receiptId: number | null; amount: number }>;
  topOutstanding: Array<{ customerId: number; outstanding: number }>;
};

export async function fetchReceivablesHealth(): Promise<ReceivablesHealth> {
  const { data } = await apiClient.get<ReceivablesHealth>("/debug/receivables-health");
  return data;
}

export async function repairReceivables(): Promise<{ repaired: Array<{ id: number; newPaid: number }>; count: number }> {
  const { data } = await apiClient.post("/debug/receivables-repair");
  return data;
}

export async function repairReceiptById(
  receiptId: number,
): Promise<{ id: number; amountPaid: number; isPaid: boolean }> {
  const { data } = await apiClient.post(`/debug/receipts/${receiptId}/repair`);
  return data;
}

export type CashLedgerEntry = {
  id: string;
  type: string;
  label: string;
  amount: number;
  date: string;
  context?: Record<string, any>;
};

export type CashLedger = {
  inflows: CashLedgerEntry[];
  outflows: CashLedgerEntry[];
  inflowTotal: number;
  outflowTotal: number;
  cashOnHand: number;
  inflowByType: Record<string, number>;
  outflowByType: Record<string, number>;
};

export async function fetchCashLedger(params?: { start?: string; end?: string; allTime?: boolean }): Promise<CashLedger> {
  const search = new URLSearchParams();
  if (params?.start) search.set("start", params.start);
  if (params?.end) search.set("end", params.end);
  if (params?.allTime) search.set("allTime", "true");
  const query = search.toString();
  const { data } = await apiClient.get<CashLedger>(`/debug/cash-ledger${query ? `?${query}` : ""}`);
  return data;
}
