import apiClient from "./client";
import type { Receipt, TehmilTenzilWeeklySummary } from "../types";

export type ReceiptItemInput = {
  productId: number;
  quantity: number;
  unitPrice?: number | null;
  displayQuantity?: number | null;
  displayUnit?: string | null;
};

export type CreateReceiptInput = {
  type?: "NORMAL" | "TVA";
  receiptNo?: string;
  date?: string;
  customerId?: number | null;
  jobSiteId?: number | null;
  walkInName?: string | null;
  driverId?: number | null;
  truckId?: number | null;
  tehmil?: boolean;
  tenzil?: boolean;
  isPaid?: boolean;
  items: ReceiptItemInput[];
};

export type UpdateReceiptInput = Partial<Omit<CreateReceiptInput, "items">> & {
  items?: ReceiptItemInput[];
  amountPaid?: number;
};

export type FetchReceiptsPageParams = {
  page?: number;
  limit?: number;
  type?: "NORMAL" | "TVA";
  customerId?: number;
  isPaid?: boolean;
  search?: string;
  driverId?: number;
  truckId?: number;
  startDate?: string;
  endDate?: string;
  sortField?: "date" | "receiptNo" | "total" | "amountPaid";
  sortOrder?: "asc" | "desc";
  productId?: number;
};

export type ReceiptsPage = {
  items: Receipt[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
};

export type ReceiptNumberPreview = {
  normal: string;
  tva: string;
};

export async function fetchReceiptsPage(
  params: FetchReceiptsPageParams = {},
): Promise<ReceiptsPage> {
  const searchParams = new URLSearchParams();
  if (params.page !== undefined) searchParams.set("page", String(params.page));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.type) searchParams.set("type", params.type);
  if (params.customerId !== undefined) searchParams.set("customerId", String(params.customerId));
  if (params.isPaid !== undefined) searchParams.set("isPaid", String(params.isPaid));
  if (params.search) searchParams.set("search", params.search);
  if (params.driverId !== undefined) searchParams.set("driverId", String(params.driverId));
  if (params.truckId !== undefined) searchParams.set("truckId", String(params.truckId));
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);
  if (params.sortField) searchParams.set("sortField", params.sortField);
  if (params.sortOrder) searchParams.set("sortOrder", params.sortOrder);
  if (params.productId !== undefined) searchParams.set("productId", String(params.productId));
  const query = searchParams.toString();
  const { data } = await apiClient.get<ReceiptsPage>(
    `/receipts/paginated${query ? `?${query}` : ""}`,
  );
  return data;
}

export async function fetchReceipts(options: {
  customerId?: number;
  includePaid?: boolean;
  type?: "NORMAL" | "TVA";
  limit?: number;
  driverId?: number;
  truckId?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
} = {}): Promise<Receipt[]> {
  const { items } = await fetchReceiptsPage({
    page: options.page ?? 1,
    customerId: options.customerId,
    type: options.type,
    ...(options.includePaid === false ? { isPaid: false } : {}),
    driverId: options.driverId,
    truckId: options.truckId,
    search: options.search,
    startDate: options.startDate,
    endDate: options.endDate,
    limit: options.limit ?? 500,
  });
  return items;
}

export async function fetchNextReceiptNumbers(): Promise<ReceiptNumberPreview> {
  const { data } = await apiClient.get<ReceiptNumberPreview>("/receipts/next-number");
  return data;
}

export async function fetchReceiptById(id: number): Promise<Receipt> {
  const { data } = await apiClient.get<Receipt>(`/receipts/${id}`);
  return data;
}

export async function createReceipt(payload: CreateReceiptInput): Promise<Receipt> {
  const { data } = await apiClient.post<Receipt>("/receipts", payload);
  return data;
}

export async function updateReceipt(id: number, payload: UpdateReceiptInput): Promise<Receipt> {
  const { data } = await apiClient.put<Receipt>(`/receipts/${id}`, payload);
  return data;
}

export async function deleteReceipt(id: number): Promise<void> {
  await apiClient.delete(`/receipts/${id}`);
}

export async function overrideReceiptNumber(id: number, receiptNo: string): Promise<Receipt> {
  const { data } = await apiClient.patch<Receipt>(`/receipts/${id}/number`, { receiptNo });
  return data;
}

export type FlaggedReceiptSummary = {
  id: number;
  receiptNo: string | null;
  date: string;
  total: number;
  amountPaid: number | null;
  customer: { id: number; name: string | null } | null;
  walkInName: string | null;
};

export type ReceiptFlagSummary = {
  summary: {
    tehmilDueCount: number;
    tehmilDueTotal: number;
    tenzilDueCount: number;
    tenzilDueTotal: number;
  };
  tehmilDue: FlaggedReceiptSummary[];
  tenzilDue: FlaggedReceiptSummary[];
};

export async function fetchReceiptFlagSummary(limit = 100): Promise<ReceiptFlagSummary> {
  const searchParams = new URLSearchParams();
  if (limit) {
    searchParams.set("limit", String(limit));
  }
  const { data } = await apiClient.get<ReceiptFlagSummary>(
    `/receipts/flags-summary${limit ? `?${searchParams.toString()}` : ""}`,
  );
  return data;
}

export type FlagPaymentPayload = {
  amount?: number | null;
  date?: string;
  note?: string;
  quantity?: number | null;
};

export async function settleTehmilPayment(
  receiptId: number,
  payload: FlagPaymentPayload,
): Promise<void> {
  await apiClient.post(`/receipts/${receiptId}/tehmil-payment`, payload);
}

export async function settleTenzilPayment(
  receiptId: number,
  payload: FlagPaymentPayload,
): Promise<void> {
  await apiClient.post(`/receipts/${receiptId}/tenzil-payment`, payload);
}

export type FlagBulkPaymentPayload = {
  type: "TEHMIL" | "TENZIL";
  startDate: string;
  endDate: string;
  amount: number;
  date?: string;
  note?: string;
};

export async function recordFlagBulkPayment(payload: FlagBulkPaymentPayload): Promise<void> {
  await apiClient.post("/receipts/flags/bulk-payment", payload);
}

export async function fetchTehmilTenzilWeeklySummary(params: { start?: string; end?: string } = {}) {
  const search = new URLSearchParams();
  if (params.start) search.append("start", params.start);
  if (params.end) search.append("end", params.end);
  const query = search.toString();
  const { data } = await apiClient.get<TehmilTenzilWeeklySummary>(
    `/receipts/tehmil-tenzil/weekly-summary${query ? `?${query}` : ""}`,
  );
  return data;
}
