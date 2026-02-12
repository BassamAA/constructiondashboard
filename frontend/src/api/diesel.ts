import apiClient from "./client";
import type { DieselLogsResponse, DieselPurchasesResponse, DieselLog } from "../types";

export async function fetchDieselPurchases(): Promise<DieselPurchasesResponse> {
  const { data } = await apiClient.get<DieselPurchasesResponse>("/diesel/purchases");
  return data;
}

export async function fetchDieselLogs(): Promise<DieselLogsResponse> {
  const { data } = await apiClient.get<DieselLogsResponse>("/diesel/logs");
  return data;
}

export type CreateDieselLogInput = {
  date?: string;
  truckId?: number | null;
  driverId?: number | null;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  notes?: string | null;
  productId?: number | null;
};

export async function createDieselLog(payload: CreateDieselLogInput): Promise<DieselLog> {
  const { data } = await apiClient.post<DieselLog>("/diesel/logs", payload);
  return data;
}
