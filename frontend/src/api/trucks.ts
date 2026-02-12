import apiClient from "./client";
import type { Truck, TruckRepair } from "../types";

export type MutateTruckPayload = {
  plateNo: string;
  driverId?: number | null;
  insuranceExpiry?: string | null;
};

export async function fetchTrucks(): Promise<Truck[]> {
  const { data } = await apiClient.get<Truck[]>("/trucks");
  return data;
}

export async function createTruck(payload: MutateTruckPayload): Promise<Truck> {
  const { data } = await apiClient.post<Truck>("/trucks", payload);
  return data;
}

export async function updateTruck(id: number, payload: MutateTruckPayload): Promise<Truck> {
  const { data } = await apiClient.put<Truck>(`/trucks/${id}`, payload);
  return data;
}

export async function deleteTruck(id: number): Promise<void> {
  await apiClient.delete(`/trucks/${id}`);
}

export type CreateTruckRepairPayload = {
  amount: number;
  date?: string;
  description?: string;
  supplierId?: number | null;
  type?: "REPAIR" | "OIL_CHANGE" | "INSURANCE";
  quantity?: number;
  toolId?: number | null;
};

export async function fetchTruckRepairs(truckId: number): Promise<TruckRepair[]> {
  const { data } = await apiClient.get<TruckRepair[]>(`/trucks/${truckId}/repairs`);
  return data;
}

export async function createTruckRepair(
  truckId: number,
  payload: CreateTruckRepairPayload,
): Promise<TruckRepair> {
  const { data } = await apiClient.post<TruckRepair>(`/trucks/${truckId}/repairs`, payload);
  return data;
}
