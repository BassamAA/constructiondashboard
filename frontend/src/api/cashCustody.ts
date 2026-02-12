import apiClient from "./client";
import type { CashCustodyEntry } from "../types";

export type CashCustodyResponse = {
  entries: CashCustodyEntry[];
  outstanding: {
    employee: {
      id: number;
      name: string;
    };
    amount: number;
  }[];
  employees: {
    id: number;
    name: string;
  }[];
};

export type CashCustodyPayload = {
  amount: number;
  fromEmployeeId: number;
  toEmployeeId: number;
  description?: string;
};

export async function fetchCashCustody(): Promise<CashCustodyResponse> {
  const { data } = await apiClient.get<CashCustodyResponse>("/cash/custody");
  return data;
}

export async function createCashCustodyEntry(
  payload: CashCustodyPayload,
): Promise<CashCustodyEntry> {
  const { data } = await apiClient.post<CashCustodyEntry>("/cash/custody", payload);
  return data;
}
