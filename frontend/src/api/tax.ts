import apiClient from "./client";

export type TaxReportRecord = {
  id: number;
  [key: string]: unknown;
};

export type SalesRecord = {
  id: number;
  receiptNo: string | null;
  date: string;
  customerName: string;
  type: string;
  total: number;
  amountPaid: number;
  outstanding: number;
  isPaid: boolean;
};

export type PurchaseRecord = {
  id: number;
  date: string;
  supplierName: string | null;
  productName: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  isPaid: boolean;
  notes: string | null;
};

export type PayrollRecord = {
  id: number;
  periodStart: string;
  periodEnd: string;
  employeeName: string;
  type: string;
  amount: number;
  quantity: number | null;
  notes: string | null;
};

export type CashRecord = {
  id: number;
  date: string;
  type: string;
  amount: number;
  description: string | null;
  createdBy: string | null;
};

export type StatementRecord = {
  name: string;
  total: number;
  paid: number;
  outstanding: number;
};

export type TrialBalanceRecord = {
  account: string;
  debit: number;
  credit: number;
};

export type TaxReportsResponse = {
  filters: {
    startDate: string | null;
    endDate: string | null;
    customerId: number | null;
    supplierId: number | null;
  };
  sales: SalesRecord[];
  purchases: PurchaseRecord[];
  payroll: PayrollRecord[];
  cash: CashRecord[];
  statementOfAccount: StatementRecord[];
  trialBalance: TrialBalanceRecord[];
  customers: Array<{ id: number; name: string }>;
  suppliers: Array<{ id: number; name: string }>;
};

export async function fetchTaxReports(params: {
  startDate?: string;
  endDate?: string;
  customerId?: string;
  supplierId?: string;
}): Promise<TaxReportsResponse> {
  const search = new URLSearchParams();
  if (params.startDate) search.set("startDate", params.startDate);
  if (params.endDate) search.set("endDate", params.endDate);
  if (params.customerId) search.set("customerId", params.customerId);
  if (params.supplierId) search.set("supplierId", params.supplierId);
  const query = search.toString();
  const url = query.length > 0 ? `/tax/reports?${query}` : "/tax/reports";
  const { data } = await apiClient.get<TaxReportsResponse>(url);
  return data;
}
