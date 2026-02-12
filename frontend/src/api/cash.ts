import apiClient from "./client";

export type CashEntryPayload = {
  amount: number;
  type: "DEPOSIT" | "WITHDRAW" | "OWNER_DRAW";
  description?: string;
};

export async function createCashEntry(payload: CashEntryPayload): Promise<void> {
  await apiClient.post("/cash/entries", payload);
}

export async function fetchCashSummary() {
  const { data } = await apiClient.get<{
    cashOnHand: number;
    paidIn: number;
    paidOut: number;
    receivables: number;
    payables: number;
  }>("/cash/summary");
  return data;
}
