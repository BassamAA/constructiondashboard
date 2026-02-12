import apiClient from "./client";
import type {
  InventoryEntry,
  InventoryEntriesResponse,
  InventoryPayablesSummary,
  ProductionHistoryResponse,
  ProductionLaborSummary,
  ProductionLaborWeeklySummary,
} from "../types";

export type InventoryEntryPayload = {
  type: "PURCHASE" | "PRODUCTION";
  inventoryNo?: string | null;
  supplierId?: number | null;
  productId: number;
  quantity: number;
  productionSite?: string | null;
  powderUsed?: number | null;
  powderProductId?: number | null;
  cementUsed?: number | null;
  cementProductId?: number | null;
  notes?: string | null;
  date?: string;
  unitCost?: number | null;
  isPaid?: boolean;
  laborPaid?: boolean;
  laborAmount?: number | null;
  helperLaborAmount?: number | null;
  workerEmployeeId?: number | null;
  helperEmployeeId?: number | null;
  tvaEligible?: boolean;
};

export type InventoryEntriesParams = {
  productId?: number;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  order?: "asc" | "desc";
};

export async function fetchNextInventoryNumbers(): Promise<{ purchase: string; production: string }> {
  const { data } = await apiClient.get<{ purchase: string; production: string }>(
    "/inventory/next-number",
  );
  return data;
}

export async function fetchInventoryEntries(
  params: InventoryEntriesParams = {},
): Promise<InventoryEntriesResponse> {
  const searchParams = new URLSearchParams();
  if (params.productId !== undefined) {
    searchParams.set("productId", String(params.productId));
  }
  if (params.page) searchParams.set("page", String(params.page));
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
  if (params.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params.order) searchParams.set("order", params.order);
  const query = searchParams.toString();
  const { data } = await apiClient.get<InventoryEntriesResponse>(
    `/inventory${query ? `?${query}` : ""}`,
  );
  return data;
}

export async function createInventoryEntry(
  payload: InventoryEntryPayload,
): Promise<InventoryEntry> {
  const { data } = await apiClient.post<InventoryEntry>("/inventory", payload);
  return data;
}

export async function updateInventoryEntry(
  id: number,
  payload: InventoryEntryPayload,
): Promise<InventoryEntry> {
  const { data } = await apiClient.put<InventoryEntry>(`/inventory/${id}`, payload);
  return data;
}

export async function fetchInventoryEntry(id: number): Promise<InventoryEntry> {
  const { data } = await apiClient.get<InventoryEntry>(`/inventory/${id}`);
  return data;
}

export async function deleteInventoryEntry(id: number): Promise<void> {
  await apiClient.delete(`/inventory/${id}`);
}

export async function fetchInventoryPayables(): Promise<InventoryPayablesSummary> {
  const { data } = await apiClient.get<InventoryPayablesSummary>("/inventory/payables");
  return data;
}

export async function markInventoryEntryPaid(id: number): Promise<InventoryEntry> {
  const { data } = await apiClient.post<InventoryEntry>(`/inventory/${id}/mark-paid`);
  return data;
}

export async function fetchProductionLaborQueue(): Promise<ProductionLaborSummary> {
  const { data } = await apiClient.get<ProductionLaborSummary>("/inventory/production-payables");
  return data;
}

export async function fetchProductionLaborWeeklySummary(params: { start?: string; end?: string } = {}) {
  const search = new URLSearchParams();
  if (params.start) search.append("start", params.start);
  if (params.end) search.append("end", params.end);
  const query = search.toString();
  const { data } = await apiClient.get<ProductionLaborWeeklySummary>(
    `/inventory/production-payables/weekly-summary${query ? `?${query}` : ""}`,
  );
  return data;
}

export type ProductionHistoryParams = {
  page?: number;
  pageSize?: number;
  order?: "asc" | "desc";
  productId?: number;
};

export async function fetchProductionHistory(
  params: ProductionHistoryParams = {},
): Promise<ProductionHistoryResponse> {
  const search = new URLSearchParams();
  if (params.page) search.append("page", String(params.page));
  if (params.pageSize) search.append("pageSize", String(params.pageSize));
  if (params.order) search.append("order", params.order);
  if (params.productId) search.append("productId", String(params.productId));
  const query = search.toString();
  const { data } = await apiClient.get<ProductionHistoryResponse>(
    `/inventory/production-history${query ? `?${query}` : ""}`,
  );
  return data;
}

export async function markProductionLaborPaid(id: number, paidAt?: string) {
  const { data } = await apiClient.post<InventoryEntry>(`/inventory/${id}/mark-labor-paid`, {
    paidAt,
  });
  return data;
}
