import apiClient from "./client";
import type { InvoicePreview, InvoiceRecord } from "../types";

export type InvoicePriceOverride = {
  receiptId: number;
  items: {
    itemId: number;
    unitPrice: number;
  }[];
};

export type InvoicePreviewPayload = {
  receiptIds?: number[];
  amount?: number;
  includePaid?: boolean;
  priceOverrides?: InvoicePriceOverride[];
  jobSiteId?: number | null;
};

export async function createInvoicePreview(
  customerId: number,
  payload: InvoicePreviewPayload,
): Promise<InvoicePreview> {
  const { data } = await apiClient.post<InvoicePreview>(
    `/receipts/customers/${customerId}/invoice-preview`,
    payload,
  );
  return data;
}

export async function createInvoice(
  customerId: number,
  payload: InvoicePreviewPayload & { notes?: string },
): Promise<InvoiceRecord> {
  const { data } = await apiClient.post<InvoiceRecord>("/invoices", {
    customerId,
    ...payload,
  });
  return data;
}

export async function fetchInvoices(): Promise<InvoiceRecord[]> {
  const { data } = await apiClient.get<InvoiceRecord[]>("/invoices");
  return data;
}

export async function fetchInvoiceById(id: number): Promise<InvoiceRecord> {
  const { data } = await apiClient.get<InvoiceRecord>(`/invoices/${id}`);
  return data;
}

export async function markInvoicePaid(
  id: number,
  paidAt?: string,
): Promise<InvoiceRecord> {
  const { data } = await apiClient.post<InvoiceRecord>(`/invoices/${id}/mark-paid`, {
    paidAt,
  });
  return data;
}

export async function deleteInvoice(id: number): Promise<void> {
  await apiClient.delete(`/invoices/${id}`);
}
