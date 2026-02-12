import apiClient from "./client";
import type { DebrisEntry } from "../types";

export type CreateDebrisRemovalInput = {
  date?: string;
  supplierId: number;
  volume: number;
  amount?: number;
  notes?: string;
};

export type MarkDebrisRemovalPaidInput = {
  supplierId: number;
  amount?: number;
  date?: string;
  description?: string;
  category?: string;
  reference?: string;
};

export type UpdateDebrisRemovalInput = {
  date?: string;
  supplierId?: number | null;
  volume?: number;
  amount?: number | null;
  notes?: string | null;
};

export async function fetchDebris(params?: {
  status?: "PENDING" | "REMOVED";
  customerId?: number;
  paid?: boolean;
}): Promise<DebrisEntry[]> {
  const { data } = await apiClient.get<DebrisEntry[]>("/debris", { params });
  return data;
}

export async function createDebrisRemoval(payload: CreateDebrisRemovalInput): Promise<DebrisEntry> {
  const { data } = await apiClient.post<DebrisEntry>("/debris", payload);
  return data;
}

export async function markDebrisRemovalPaid(
  id: number,
  payload: MarkDebrisRemovalPaidInput,
): Promise<DebrisEntry> {
  const { data } = await apiClient.post<DebrisEntry>(`/debris/${id}/mark-paid`, payload);
  return data;
}

export async function markDebrisRemovalUnpaid(id: number): Promise<DebrisEntry> {
  const { data } = await apiClient.post<DebrisEntry>(`/debris/${id}/mark-unpaid`);
  return data;
}

export async function updateDebrisRemoval(
  id: number,
  payload: UpdateDebrisRemovalInput,
): Promise<DebrisEntry> {
  const { data } = await apiClient.put<DebrisEntry>(`/debris/${id}`, payload);
  return data;
}

export async function deleteDebrisRemoval(id: number): Promise<void> {
  await apiClient.delete(`/debris/${id}`);
}
