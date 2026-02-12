import apiClient from "./client";
import type { Customer } from "../types";

export type CreateCustomerInput = {
  name: string;
  receiptType?: "NORMAL" | "TVA";
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export async function fetchCustomers(): Promise<Customer[]> {
  const { data } = await apiClient.get<Customer[]>("/customers");
  return data;
}

export async function createCustomer(payload: CreateCustomerInput): Promise<Customer> {
  const { data } = await apiClient.post<Customer>("/customers", payload);
  return data;
}

export async function updateCustomer(
  id: number,
  payload: UpdateCustomerInput,
): Promise<Customer> {
  const { data } = await apiClient.put<Customer>(`/customers/${id}`, payload);
  return data;
}

export async function deleteCustomer(id: number): Promise<void> {
  await apiClient.delete(`/customers/${id}`);
}

export async function overrideCustomerBalance(
  id: number,
  payload: { amount: number | null; note?: string },
): Promise<Customer> {
  const { data } = await apiClient.post<Customer>(`/customers/${id}/manual-balance`, payload);
  return data;
}
