import apiClient from "./client";
import type {
  PayrollEntry,
  PayrollRun,
  PayrollRunStatus,
  PayrollType,
} from "../types";

export type CreatePayrollInput = {
  employeeId: number;
  periodStart?: string;
  periodEnd?: string;
  type?: PayrollType;
  quantity?: number;
  amount?: number;
  notes?: string;
  createPayment?: boolean;
  paymentDate?: string;
  paymentReference?: string;
  stoneProductId?: number;
  helperEmployeeId?: number;
};

export async function fetchPayroll(): Promise<PayrollEntry[]> {
  const { data } = await apiClient.get<PayrollEntry[]>("/payroll");
  return data;
}

export async function createPayrollEntry(payload: CreatePayrollInput): Promise<PayrollEntry> {
  const { data } = await apiClient.post<PayrollEntry>("/payroll", payload);
  return data;
}

export type PayrollPage = {
  items: PayrollEntry[];
  nextCursor: number | null;
};

export async function fetchPayrollPage({
  cursor,
  limit,
}: {
  cursor?: number;
  limit?: number;
} = {}): Promise<PayrollPage> {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", String(cursor));
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const { data } = await apiClient.get<PayrollPage>(`/payroll/paginated${query}`);
  return data;
}

export type CreatePayrollRunInput = {
  frequency: "WEEKLY" | "MONTHLY";
  periodStart: string;
  periodEnd: string;
  debitAt?: string;
  notes?: string;
  entryIds?: number[];
  autoGenerate?: boolean;
};

export async function createPayrollRun(payload: CreatePayrollRunInput): Promise<PayrollRun> {
  const { data } = await apiClient.post<PayrollRun>("/payroll/runs", payload);
  return data;
}

export async function fetchPayrollRuns(status?: PayrollRunStatus): Promise<PayrollRun[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const query = params.toString() ? `?${params.toString()}` : "";
  const { data } = await apiClient.get<PayrollRun[]>(`/payroll/runs${query}`);
  return data;
}

export async function fetchPayrollRun(id: number): Promise<PayrollRun> {
  const { data } = await apiClient.get<PayrollRun>(`/payroll/runs/${id}`);
  return data;
}

export async function finalizePayrollRun(
  id: number,
  payload: { debitAt?: string; notes?: string } = {},
): Promise<PayrollRun> {
  const { data } = await apiClient.post<PayrollRun>(`/payroll/runs/${id}/finalize`, payload);
  return data;
}

export async function debitPayrollRun(id: number): Promise<PayrollRun> {
  const { data } = await apiClient.post<PayrollRun>(`/payroll/runs/${id}/debit`);
  return data;
}
