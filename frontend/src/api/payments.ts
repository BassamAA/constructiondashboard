import apiClient from "./client";
import type { Payment, PaymentType } from "../types";

export type PaymentInput = {
  date?: string;
  amount: number;
  type: PaymentType;
  description?: string;
  category?: string;
  reference?: string;
  supplierId?: number | null;
  customerId?: number | null;
  receiptId?: number | null;
  payrollEntryId?: number | null;
  debrisEntryId?: number | null;
};

export async function fetchPayments(params?: {
  type?: PaymentType;
  supplierId?: number;
  customerId?: number;
  receiptId?: number;
  employeeId?: number;
  description?: string;
}): Promise<Payment[]> {
  const { data } = await apiClient.get<Payment[]>("/payments", { params });
  return data;
}

export async function createPayment(payload: PaymentInput): Promise<Payment> {
  const { data } = await apiClient.post<Payment>("/payments", payload);
  return data;
}

export async function updatePayment(id: number, payload: PaymentInput): Promise<Payment> {
  const { data } = await apiClient.put<Payment>(`/payments/${id}`, payload);
  return data;
}

export async function deletePayment(id: number): Promise<void> {
  await apiClient.delete(`/payments/${id}`);
}
