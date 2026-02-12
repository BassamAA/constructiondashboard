import apiClient from "./client";
import type {
  CustomReportDataset,
  CustomReportResponse,
  DebrisStatus,
  InventoryEntryType,
  PaymentType,
  PayrollType,
  DailyReport,
  ReportSummary,
} from "../types";

export type ReportQueryParams = {
  start?: string;
  end?: string;
  groupBy?: "day" | "week" | "month";
  productIds?: number[];
  customerIds?: number[];
};

export async function fetchReportSummary(params: ReportQueryParams = {}): Promise<ReportSummary> {
  const search = new URLSearchParams();
  if (params.start) search.append("start", params.start);
  if (params.end) search.append("end", params.end);
  if (params.groupBy) search.append("groupBy", params.groupBy);
  if (params.productIds && params.productIds.length > 0) {
    search.append("productIds", params.productIds.join(","));
  }
  if (params.customerIds && params.customerIds.length > 0) {
    search.append("customerIds", params.customerIds.join(","));
  }

  const query = search.toString();
  const url = query ? `/reports/summary?${query}` : "/reports/summary";
  const { data } = await apiClient.get<ReportSummary>(url);
  return data;
}

export type DailyReportParams = {
  date: string;
  productIds?: number[];
  customerIds?: number[];
};

export async function fetchDailyReport(params: DailyReportParams): Promise<DailyReport> {
  const search = new URLSearchParams();
  search.append("date", params.date);
  if (params.productIds && params.productIds.length > 0) {
    search.append("productIds", params.productIds.join(","));
  }
  if (params.customerIds && params.customerIds.length > 0) {
    search.append("customerIds", params.customerIds.join(","));
  }
  const query = search.toString();
  const { data } = await apiClient.get<DailyReport>(`/reports/daily?${query}`);
  return data;
}

export async function downloadFinancialInventoryPdf(params: { start?: string; end?: string }): Promise<Blob> {
  const search = new URLSearchParams();
  if (params.start) search.append("start", params.start);
  if (params.end) search.append("end", params.end);
  const query = search.toString();
  const url = query ? `/reports/exports/financial-pdf?${query}` : "/reports/exports/financial-pdf";
  const response = await apiClient.get(url, { responseType: "blob" });
  return response.data as Blob;
}

export async function downloadBalancesPdf(): Promise<Blob> {
  const response = await apiClient.get("/reports/exports/balances-pdf", { responseType: "blob" });
  return response.data as Blob;
}

export async function downloadDailyPdf(params: DailyReportParams): Promise<Blob> {
  const search = new URLSearchParams();
  search.append("date", params.date);
  if (params.productIds && params.productIds.length > 0) {
    search.append("productIds", params.productIds.join(","));
  }
  if (params.customerIds && params.customerIds.length > 0) {
    search.append("customerIds", params.customerIds.join(","));
  }
  const query = search.toString();
  const response = await apiClient.get(`/reports/exports/daily-pdf?${query}`, { responseType: "blob" });
  return response.data as Blob;
}

export type CustomReportQuery = {
  dataset: CustomReportDataset;
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
  aggregateBy?: string;
  customerId?: number;
  supplierId?: number;
  jobSiteId?: number;
  productId?: number;
  paymentType?: PaymentType;
  receiptType?: "NORMAL" | "TVA";
  status?: DebrisStatus;
  payrollType?: PayrollType;
  inventoryType?: InventoryEntryType;
  isPaid?: boolean;
  limit?: number;
};

export async function fetchCustomReport(params: CustomReportQuery): Promise<CustomReportResponse> {
  const search = new URLSearchParams();
  search.append("dataset", params.dataset);
  if (params.from) search.append("from", params.from);
  if (params.to) search.append("to", params.to);
  if (params.groupBy) search.append("groupBy", params.groupBy);
  if (params.aggregateBy) search.append("aggregateBy", params.aggregateBy);
  if (params.customerId) search.append("customerId", String(params.customerId));
  if (params.supplierId) search.append("supplierId", String(params.supplierId));
  if (params.jobSiteId) search.append("jobSiteId", String(params.jobSiteId));
  if (params.productId) search.append("productId", String(params.productId));
  if (params.paymentType) search.append("paymentType", params.paymentType);
  if (params.receiptType) search.append("receiptType", params.receiptType);
  if (params.status) search.append("status", params.status);
  if (params.payrollType) search.append("payrollType", params.payrollType);
  if (params.inventoryType) search.append("inventoryType", params.inventoryType);
  if (typeof params.isPaid === "boolean") search.append("isPaid", String(params.isPaid));
  if (params.limit) search.append("limit", String(params.limit));

  const query = search.toString();
  const { data } = await apiClient.get<CustomReportResponse>(`/reports/custom?${query}`);
  return data;
}
