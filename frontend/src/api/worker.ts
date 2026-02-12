import apiClient from "./client";
import type { Receipt } from "../types";

type WorkerReceiptResponse = {
  receipt: Receipt;
};

const WORKER_BASE = "/worker";

export async function fetchWorkerReceiptById(receiptId: number): Promise<Receipt> {
  const { data } = await apiClient.get<WorkerReceiptResponse>(
    `${WORKER_BASE}/receipts/${receiptId}/print`,
  );
  return data.receipt;
}

export async function fetchWorkerReceiptByNumber(receiptNo: string): Promise<Receipt> {
  const { data } = await apiClient.get<WorkerReceiptResponse>(
    `${WORKER_BASE}/receipts/by-number/${encodeURIComponent(receiptNo)}`,
  );
  return data.receipt;
}
