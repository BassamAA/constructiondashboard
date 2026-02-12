import apiClient from "./client";

export type ReceiptActivitySummary = {
  receipts: Array<{
    receiptId: number;
    receiptNo: string;
    customerName: string;
    issuedOn: string | null;
    printCount: number;
    updateCount: number;
    deleteCount: number;
    lastPrintedAt: string | null;
    lastUpdatedAt: string | null;
    lastDeletedAt: string | null;
  }>;
  invoices: Array<{
    customerId: number;
    customerName: string;
    printCount: number;
    lastPrintedAt: string | null;
  }>;
};

export async function logReceiptPrint(receiptId: number): Promise<void> {
  await apiClient.post(`/worker/receipts/${receiptId}/print-log`);
}

export async function logInvoicePrint(payload: { customerId: number; receiptIds: number[] }): Promise<void> {
  await apiClient.post("/audit-logs/invoice-print", payload);
}

export async function fetchReceiptActivity(): Promise<ReceiptActivitySummary> {
  const { data } = await apiClient.get<ReceiptActivitySummary>("/audit-logs/activity");
  return data;
}
