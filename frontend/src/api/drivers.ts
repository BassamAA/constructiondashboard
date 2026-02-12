import apiClient from "./client";
import type { Driver } from "../types";

export async function fetchDrivers(): Promise<Driver[]> {
  const { data } = await apiClient.get<Driver[]>("/drivers");
  return data;
}

export type CreateDriverPayload = {
  name: string;
  phone?: string | null;
};

export async function createDriver(payload: CreateDriverPayload): Promise<Driver> {
  const { data } = await apiClient.post<Driver>("/drivers", payload);
  return data;
}
