import apiClient from "./client";
import type { Supplier } from "../types";

export type CreateSupplierInput = {
  name: string;
  contact?: string;
  notes?: string;
};

export type UpdateSupplierInput = Partial<CreateSupplierInput>;

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data } = await apiClient.get<Supplier[]>("/suppliers");
  return data;
}

export async function createSupplier(payload: CreateSupplierInput): Promise<Supplier> {
  const { data } = await apiClient.post<Supplier>("/suppliers", payload);
  return data;
}

export async function updateSupplier(
  id: number,
  payload: UpdateSupplierInput,
): Promise<Supplier> {
  const { data } = await apiClient.put<Supplier>(`/suppliers/${id}`, payload);
  return data;
}

export async function deleteSupplier(id: number): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`);
}

export async function overrideSupplierBalance(
  id: number,
  payload: { amount: number | null; note?: string },
): Promise<Supplier> {
  const { data } = await apiClient.post<Supplier>(`/suppliers/${id}/manual-balance`, payload);
  return data;
}
