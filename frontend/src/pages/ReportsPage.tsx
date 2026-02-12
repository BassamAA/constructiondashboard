import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  downloadBalancesPdf,
  downloadFinancialInventoryPdf,
  fetchCustomReport,
  fetchDailyReport,
  fetchReportSummary,
  type CustomReportQuery,
} from "../api/reports";
import { fetchProducts } from "../api/products";
import { fetchCustomers } from "../api/customers";
import { fetchSuppliers } from "../api/suppliers";
import { fetchJobSites } from "../api/jobSites";
import type {
  CustomReportDataset,
  CustomReportGroup,
  CustomReportResponse,
  Customer,
  DailyReport,
  DebrisStatus,
  InventoryEntryType,
  JobSite,
  PaymentType,
  PayrollType,
  Product,
  ReportSummary,
  Supplier,
} from "../types";
import { fetchReceiptActivity } from "../api/audit";
import { useAuth } from "../context/AuthContext";

const toDateObj = (value: string | Date): Date => {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
};

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;
const formatNumber = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const formatOptionalCurrency = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : formatCurrency(value);
const formatPercentage = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`;
const formatDate = (value: string | Date): string => {
  const date = toDateObj(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
};
const formatTime = (value: string | Date): string => {
  const date = toDateObj(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const formatDateTime = (value: string | Date | null | undefined): string => {
  if (!value) return "—";
  const date = toDateObj(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const humanizePaymentType = (type: string): string =>
  type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const datasetLabels: Record<CustomReportDataset, string> = {
  receipts: "Receipts",
  payments: "Payments",
  payroll: "Payroll",
  debris: "Debris",
  inventory: "Inventory",
};

const humanizeDataset = (dataset: CustomReportDataset) => datasetLabels[dataset] ?? dataset;

const escapeCsvValue = (value: string | number): string => {
  const stringValue = typeof value === "number" ? value.toString() : value;
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const exportToCsv = (filename: string, headers: string[], rows: Array<Array<string | number>>): void => {
  const csvLines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const timeframeOptions = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const groupByOptions = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

type TimelineSeriesPoint = {
  period: string;
  revenue: number;
  topProductName?: string;
  topProductRevenue?: number;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function getDefaultRange(timeframe: string): { start?: string; end?: string } {
  const today = new Date();
  switch (timeframe) {
    case "all":
      return { start: undefined, end: undefined };
    case "7d": {
      const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start: start.toISOString().slice(0, 10), end: todayIso() };
    }
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: start.toISOString().slice(0, 10), end: todayIso() };
    }
    case "30d":
    default: {
      const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start: start.toISOString().slice(0, 10), end: todayIso() };
    }
  }
}

export function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [timeframe, setTimeframe] = useState<string>("30d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("week");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [dailyDate, setDailyDate] = useState<string>(todayIso());
  const [dailyProductIds, setDailyProductIds] = useState<string[]>([]);
  const [dailyCustomerIds, setDailyCustomerIds] = useState<string[]>([]);
  const [customDataset, setCustomDataset] = useState<CustomReportDataset>("receipts");
  const [customGroupBy, setCustomGroupBy] = useState<"day" | "week" | "month">("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customCustomerId, setCustomCustomerId] = useState("");
  const [customJobSiteId, setCustomJobSiteId] = useState("");
  const [customSupplierId, setCustomSupplierId] = useState("");
  const [customProductId, setCustomProductId] = useState("");
  const [customPaymentType, setCustomPaymentType] = useState<PaymentType | "">("");
  const [customReceiptType, setCustomReceiptType] = useState<"NORMAL" | "TVA" | "">("");
  const [customDebrisStatus, setCustomDebrisStatus] = useState<DebrisStatus | "">("");
  const [customPayrollType, setCustomPayrollType] = useState<PayrollType | "">("");
  const [customInventoryType, setCustomInventoryType] = useState<InventoryEntryType | "">("");
  const [customIsPaid, setCustomIsPaid] = useState<"" | "true" | "false">("");
  const [customLimit, setCustomLimit] = useState("500");
  const [customParams, setCustomParams] = useState<CustomReportQuery>({
    dataset: "receipts",
    groupBy: "day",
  });
  const [customAggregateBy, setCustomAggregateBy] = useState<string>("");

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["products", "reports"],
    queryFn: fetchProducts,
  });
  const {
    data: customers = [],
    isLoading: customersLoading,
  } = useQuery<Customer[]>({
    queryKey: ["customers", "reports"],
    queryFn: fetchCustomers,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers", "reports"],
    queryFn: fetchSuppliers,
  });
  const { data: jobSites = [] } = useQuery<JobSite[]>({
    queryKey: ["jobSites", "reports"],
    queryFn: () => fetchJobSites(),
  });

  const selectedProductIdsNumbers = useMemo(
    () =>
      selectedProductIds
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value)),
    [selectedProductIds],
  );
  const selectedCustomerIdsNumbers = useMemo(
    () =>
      selectedCustomerIds
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value)),
    [selectedCustomerIds],
  );

  const dailyProductIdsNumbers = useMemo(
    () =>
      dailyProductIds
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value)),
    [dailyProductIds],
  );
  const dailyCustomerIdsNumbers = useMemo(
    () =>
      dailyCustomerIds
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value)),
    [dailyCustomerIds],
  );

  const isSummaryProductFilterActive = selectedProductIdsNumbers.length > 0;
  const isSummaryCustomerFilterActive = selectedCustomerIdsNumbers.length > 0;
  const selectedSummaryProductNames = useMemo(() => {
    if (!isSummaryProductFilterActive) return [];
    const idSet = new Set(selectedProductIdsNumbers);
    return products.filter((product) => idSet.has(product.id)).map((product) => product.name);
  }, [isSummaryProductFilterActive, selectedProductIdsNumbers, products]);
  const selectedSummaryCustomerNames = useMemo(() => {
    if (!isSummaryCustomerFilterActive) return [];
    const idSet = new Set(selectedCustomerIdsNumbers);
    return customers.filter((customer) => idSet.has(customer.id)).map((customer) => customer.name);
  }, [isSummaryCustomerFilterActive, selectedCustomerIdsNumbers, customers]);
  const hasDailyProductFilter = dailyProductIdsNumbers.length > 0;
  const hasDailyCustomerFilter = dailyCustomerIdsNumbers.length > 0;
  const selectedDailyProductNames = useMemo(() => {
    if (!hasDailyProductFilter) return [];
    const idSet = new Set(dailyProductIdsNumbers);
    return products.filter((product) => idSet.has(product.id)).map((product) => product.name);
  }, [hasDailyProductFilter, dailyProductIdsNumbers, products]);
  const dailyDateLabel = useMemo(() => (dailyDate ? formatDate(dailyDate) : ""), [dailyDate]);

  const range = useMemo(() => {
    if (timeframe === "custom") {
      return { start: customStart || undefined, end: customEnd || undefined };
    }
    return getDefaultRange(timeframe);
  }, [timeframe, customStart, customEnd]);

  const derivedGroupBy = useMemo(() => {
    if (groupBy) return groupBy;
    if (timeframe === "7d") return "day";
    if (timeframe === "30d") return "week";
    return "month";
  }, [groupBy, timeframe]);

  const queryEnabled = timeframe !== "custom" ? true : Boolean(range.start && range.end);

  const summaryProductsKey = selectedProductIdsNumbers.join(",");
  const summaryCustomersKey = selectedCustomerIdsNumbers.join(",");
  const dailyProductsKey = dailyProductIdsNumbers.join(",");
  const dailyCustomersKey = dailyCustomerIdsNumbers.join(",");
  const summarySectionRef = useRef<HTMLDivElement | null>(null);
  const customSectionRef = useRef<HTMLDivElement | null>(null);
  const dailySectionRef = useRef<HTMLDivElement | null>(null);

  const summaryQuery = useQuery<ReportSummary>({
    queryKey: [
      "report-summary",
      range.start,
      range.end,
      derivedGroupBy,
      summaryProductsKey,
      summaryCustomersKey,
    ],
    queryFn: () =>
      fetchReportSummary({
        start: range.start,
        end: range.end,
        groupBy: derivedGroupBy,
        productIds: selectedProductIdsNumbers.length > 0 ? selectedProductIdsNumbers : undefined,
        customerIds: selectedCustomerIdsNumbers.length > 0 ? selectedCustomerIdsNumbers : undefined,
      }),
    enabled: queryEnabled,
  });

  const dailyReportQuery = useQuery<DailyReport>({
    queryKey: ["report-daily", dailyDate, dailyProductsKey, dailyCustomersKey],
    queryFn: () =>
      fetchDailyReport({
        date: dailyDate,
        productIds: dailyProductIdsNumbers.length > 0 ? dailyProductIdsNumbers : undefined,
        customerIds: dailyCustomerIdsNumbers.length > 0 ? dailyCustomerIdsNumbers : undefined,
      }),
    enabled: Boolean(dailyDate),
  });

  const receiptActivityQuery = useQuery({
    queryKey: ["receipt-activity"],
    queryFn: fetchReceiptActivity,
    enabled: isAdmin,
    staleTime: 60 * 1000,
  });

  const customReportQuery = useQuery<CustomReportResponse>({
    queryKey: ["custom-report", customParams],
    queryFn: () => fetchCustomReport(customParams),
  });

  const dailyReport = dailyReportQuery.data;

  const summary = summaryQuery.data;
  const purchasesByProduct = summary?.purchases?.purchasesByProduct ?? [];
  const recentInventoryPurchases = summary?.purchases?.recentPurchases ?? [];
  const timelineSeries = useMemo<TimelineSeriesPoint[]>(() => {
    if (!summary) return [];
    return summary.salesTimeline.map((row) => {
      const topProduct = row.products[0];
      return {
        period: row.period,
        revenue: row.products.reduce((sum, product) => sum + product.revenue, 0),
        topProductName: topProduct?.productName,
        topProductRevenue: topProduct?.revenue,
      };
    });
  }, [summary]);

  const rangeLabel =
    range.start && range.end
      ? `${range.start} → ${range.end}`
      : range.start || range.end
        ? `${range.start ?? ""}${range.end ? ` → ${range.end}` : ""}`
        : "selected period";

  const quickFilterBadges = useMemo(() => {
    const badges: { label: string; value: string }[] = [];
    badges.push({
      label: "Timeframe",
      value:
        timeframe === "custom" && range.start && range.end
          ? `${range.start} → ${range.end}`
          : timeframeOptions.find((t) => t.value === timeframe)?.label ?? "Custom",
    });
    if (isSummaryProductFilterActive) {
      badges.push({
        label: "Products",
        value:
          selectedSummaryProductNames.length > 0
            ? selectedSummaryProductNames.join(", ")
            : `${selectedProductIdsNumbers.length} selected`,
      });
    }
    if (isSummaryCustomerFilterActive) {
      badges.push({
        label: "Customers",
        value:
          selectedSummaryCustomerNames.length > 0
            ? selectedSummaryCustomerNames.join(", ")
            : `${selectedCustomerIdsNumbers.length} selected`,
      });
    }
    return badges;
  }, [
    timeframe,
    range.start,
    range.end,
    isSummaryProductFilterActive,
    selectedSummaryProductNames,
    selectedProductIdsNumbers.length,
    isSummaryCustomerFilterActive,
    selectedSummaryCustomerNames,
    selectedCustomerIdsNumbers.length,
  ]);

  const dailyHighlightCards = useMemo(() => {
    if (!dailyReport) return [];
    return [
      {
        label: "Receipts",
        value: dailyReport.totals.receiptsCount.toLocaleString(),
        sublabel: `Total sales ${formatCurrency(dailyReport.totals.totalSales)}`,
      },
      {
        label: "Cash collected",
        value: formatCurrency(dailyReport.totals.cashCollected),
        sublabel: `Avg receipt ${formatCurrency(dailyReport.totals.averageReceiptValue)}`,
      },
      {
        label: "Filtered sales",
        value:
          hasDailyProductFilter || hasDailyCustomerFilter
            ? formatCurrency(dailyReport.totals.filteredSales)
            : formatCurrency(dailyReport.totals.totalSales),
        sublabel:
          hasDailyProductFilter || hasDailyCustomerFilter ? "Matches active filters" : "All sales today",
      },
    ];
  }, [dailyReport, hasDailyProductFilter, hasDailyCustomerFilter]);

  const scrollToSection = (ref: React.RefObject<HTMLElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const inventoryValue = useMemo(() => {
    if (!summary) return 0;
    return summary.inventory.snapshot.reduce(
      (acc, item) => acc + item.stockQty * (item.unitPrice ?? 0),
      0,
    );
  }, [summary]);

  const receivableOverdueStats = useMemo(() => {
    if (!summary?.receivables?.customers?.length) {
      return { overdueTotal: 0, overdueCount: 0 };
    }
    return summary.receivables.customers.reduce(
      (acc, row) => {
        if (row.isOverdue && row.overdueOutstanding > 0) {
          acc.overdueTotal += row.overdueOutstanding;
          acc.overdueCount += 1;
        }
        return acc;
      },
      { overdueTotal: 0, overdueCount: 0 },
    );
  }, [summary]);

  const highlightStats = useMemo(
    () =>
      !summary
        ? []
        : [
            {
              label: "Total sales",
              value: formatCurrency(summary.revenue.totalSales),
              sublabel: `Collected ${formatCurrency(summary.revenue.totalCashCollected)}`,
            },
            {
              label: "Receivables outstanding",
              value: formatCurrency(summary.revenue.outstandingAmount),
              sublabel: `Avg receipt ${formatCurrency(summary.revenue.averageReceiptValue)}`,
            },
            {
              label: "Over 30d receivables",
              value: formatCurrency(receivableOverdueStats.overdueTotal),
              sublabel:
                receivableOverdueStats.overdueCount > 0
                  ? `${receivableOverdueStats.overdueCount} customers flagged`
                  : "No overdue accounts",
            },
            {
              label: "Purchase spend",
              value: formatCurrency(summary.purchases.totalPurchaseCost),
              sublabel: `${summary.purchases.purchasesBySupplier.length} suppliers used`,
            },
            {
              label: "Inventory on hand",
              value: formatCurrency(inventoryValue),
              sublabel: `${summary.inventory.snapshot.length} products tracked`,
            },
          ],
    [summary, inventoryValue, receivableOverdueStats],
  );

  const customReport = customReportQuery.data;
  const customSummaryCards = useMemo(() => {
    if (!customReport) return [];
    switch (customReport.dataset) {
      case "receipts":
        return [
          { label: "Receipts", value: customReport.summary.count?.toLocaleString?.() ?? "0" },
          { label: "Total billed", value: formatCurrency(customReport.summary.total ?? 0) },
          { label: "Paid", value: formatCurrency(customReport.summary.amountPaid ?? 0) },
          { label: "Outstanding", value: formatCurrency(customReport.summary.outstanding ?? 0) },
        ];
      case "payments":
        return [
          { label: "Payments", value: customReport.summary.count?.toLocaleString?.() ?? "0" },
          { label: "Total outflow", value: formatCurrency(customReport.summary.totalAmount ?? 0) },
        ];
      case "payroll":
        return [
          { label: "Payroll entries", value: customReport.summary.count?.toLocaleString?.() ?? "0" },
          { label: "Payroll cost", value: formatCurrency(customReport.summary.totalAmount ?? 0) },
        ];
      case "debris":
        return [
          { label: "Debris loads", value: customReport.summary.count?.toLocaleString?.() ?? "0" },
          { label: "Volume", value: `${(customReport.summary.totalVolume ?? 0).toFixed(3)} m³` },
          { label: "Removal cost", value: formatCurrency(customReport.summary.totalRemovalCost ?? 0) },
        ];
      case "inventory":
        return [
          { label: "Inventory entries", value: customReport.summary.count?.toLocaleString?.() ?? "0" },
          { label: "Total cost", value: formatCurrency(customReport.summary.totalCost ?? 0) },
          { label: "Quantity", value: formatNumber(customReport.summary.totalQuantity ?? 0) },
        ];
      default:
        return [];
    }
  }, [customReport]);

  const handleDownloadSummary = useCallback(() => {
    if (!summary) return;
    const rows = timelineSeries.map((point) => [
      point.period,
      point.revenue.toFixed(2),
      point.topProductName ? `${point.topProductName} (${formatCurrency(point.topProductRevenue ?? 0)})` : "—",
    ]);
    const filename = `report_${range.start ?? "start"}_${range.end ?? "end"}.csv`;
    exportToCsv(filename, ["Period", "Revenue", "Top product"], rows);
  }, [summary, timelineSeries, range.start, range.end]);

  const handleShareSnapshot = useCallback(() => {
    if (!summary) return;
    const lines = [
      `Report range: ${rangeLabel}`,
      `Total sales: ${formatCurrency(summary.revenue.totalSales)}`,
      `Cash collected: ${formatCurrency(summary.revenue.totalCashCollected)}`,
      `Outstanding receivables: ${formatCurrency(summary.revenue.outstandingAmount)}`,
      `Outstanding supplier payables: ${formatCurrency(summary.purchases.outstandingPayablesTotal)}`,
    ];
    const topMaterial = summary.materialSales[0];
    if (topMaterial) {
      lines.push(
        `Top material: ${topMaterial.productName} (${formatNumber(topMaterial.quantity)} units / ${formatCurrency(topMaterial.revenue)})`,
      );
    }
    const body = encodeURIComponent(lines.join("\n"));
    const subject = encodeURIComponent(`Construction dashboard report (${rangeLabel})`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }, [summary, rangeLabel]);

  const handleDownloadCustomCsv = useCallback(() => {
    if (!customReport) return;
    const aggregated = Boolean((customReport as any)?.groups?.length && customParams.aggregateBy);
    if (aggregated) {
      const headers = ["Key", "Count", "Amount/Total", "Paid", "Outstanding"];
      const rows = customReport.groups.map((group) => [
        group.label ?? group.key,
        group.count,
        group.total ?? group.totalAmount ?? group.totalCost ?? group.totalRemovalCost ?? "",
        group.amountPaid ?? "",
        group.outstanding ?? "",
      ]);
      exportToCsv(`custom_${customReport.dataset}_summary.csv`, headers, rows);
      return;
    }
    switch (customReport.dataset) {
      case "receipts": {
        const headers = ["Receipt", "Date", "Customer", "Job site", "Type", "Total", "Paid", "Outstanding"];
        const rows = (customReport.items as any[]).map((receipt) => {
          const outstanding = Math.max((receipt.total ?? 0) - (receipt.amountPaid ?? 0), 0);
          return [
            receipt.receiptNo ?? `#${receipt.id}`,
            formatDate(receipt.date),
            receipt.customer ?? "Walk-in",
            receipt.jobSite ?? "",
            receipt.type,
            receipt.total ?? 0,
            receipt.amountPaid ?? 0,
            outstanding,
          ];
        });
        exportToCsv("custom_receipts.csv", headers, rows);
        break;
      }
      case "payments": {
        const headers = ["Date", "Type", "Amount", "Counterparty", "Description"];
        const rows = (customReport.items as any[]).map((payment) => [
          formatDate(payment.date),
          payment.type,
          payment.amount ?? 0,
          payment.customer ?? payment.supplier ?? payment.payrollEmployee ?? "",
          payment.description ?? "",
        ]);
        exportToCsv("custom_payments.csv", headers, rows);
        break;
      }
      case "payroll": {
        const headers = ["Employee", "Type", "Amount", "Quantity", "Period", "Paid at"];
        const rows = (customReport.items as any[]).map((entry) => [
          entry.employee,
          entry.type,
          entry.amount ?? 0,
          entry.quantity ?? "",
          `${formatDate(entry.periodStart)} -> ${formatDate(entry.periodEnd)}`,
          entry.paidAt ? formatDate(entry.paidAt) : "Unpaid",
        ]);
        exportToCsv("custom_payroll.csv", headers, rows);
        break;
      }
      case "debris": {
        const headers = ["Date", "Status", "Volume (m3)", "Removal cost", "Customer", "Removal payment"];
        const rows = (customReport.items as any[]).map((entry) => [
          formatDate(entry.date),
          entry.status,
          entry.volume ?? 0,
          entry.removalCost ?? 0,
          entry.customer ?? "Walk-in",
          entry.removalPaymentId ?? "",
        ]);
        exportToCsv("custom_debris.csv", headers, rows);
        break;
      }
      case "inventory": {
        const headers = ["Date", "Type", "Product", "Supplier", "Quantity", "Total cost", "Paid"];
        const rows = (customReport.items as any[]).map((entry) => [
          formatDate(entry.entryDate),
          entry.type,
          entry.product,
          entry.supplier ?? "",
          entry.quantity ?? 0,
          entry.totalCost ?? 0,
          entry.isPaid ? "Yes" : "No",
        ]);
        exportToCsv("custom_inventory.csv", headers, rows);
        break;
      }
      default:
        break;
    }
  }, [customParams.aggregateBy, customReport]);

  const handleDownloadDailyReceipts = useCallback(() => {
    if (!dailyReport) return;
    const headers = [
      "Receipt #",
      "Timestamp",
      "Customer / Walk-in",
      "Total",
      ...(hasDailyProductFilter ? ["Filtered total"] : []),
      "Paid",
      "Balance",
      "Items",
    ];
    const rows = dailyReport.receipts.map((receipt) => {
      const total = Number(receipt.total ?? 0);
      const paid = Number(receipt.amountPaid ?? 0);
      const balance = total - paid;
      const timestamp = `${formatDate(receipt.date)} ${formatTime(receipt.date)}`.trim();
      const itemsSummary = receipt.items
        .map((item) => {
          const quantity = item.displayQuantity ?? item.quantity;
          const unit = item.displayUnit ?? item.product.unit;
          return `${item.product.name} (${formatNumber(quantity)} ${unit})`;
        })
        .join(" | ");

      const row: Array<string | number> = [
        receipt.receiptNo,
        timestamp,
        receipt.customer?.name ?? receipt.walkInName ?? "Walk-in",
        total.toFixed(2),
      ];
      if (hasDailyProductFilter) {
        const filteredTotal = receipt.filteredTotal ?? null;
        row.push(filteredTotal !== null ? filteredTotal.toFixed(2) : "");
      }
      row.push(paid.toFixed(2), balance.toFixed(2), itemsSummary);
      return row;
    });
    const isoDate = dailyReport.date.slice(0, 10);
    exportToCsv(`daily_receipts_${isoDate}.csv`, headers, rows);
  }, [dailyReport, hasDailyProductFilter]);

  const handleDownloadDailyPayments = useCallback(() => {
    if (!dailyReport) return;
    const headers = ["Timestamp", "Type", "Amount", "Description", "Related party", "Linked receipt"];
    const rows = dailyReport.payments.map((payment) => {
      const timestamp = `${formatDate(payment.date)} ${formatTime(payment.date)}`.trim();
      const relatedParty = payment.customer?.name ?? payment.supplier?.name ?? "";
      return [
        timestamp,
        humanizePaymentType(payment.type),
        Number(payment.amount ?? 0).toFixed(2),
        payment.description ?? "",
        relatedParty,
        payment.receipt?.receiptNo ?? "",
      ];
    });
    const isoDate = dailyReport.date.slice(0, 10);
    exportToCsv(`daily_payments_${isoDate}.csv`, headers, rows);
  }, [dailyReport]);

  const handleDownloadPdf = useCallback(async () => {
    try {
      const blob = await downloadFinancialInventoryPdf({ start: range.start, end: range.end });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "financial_inventory_report.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download PDF", err);
      alert("Could not download PDF. Please try again.");
    }
  }, [range.end, range.start]);

  const handleDownloadBalancesPdf = useCallback(async () => {
    try {
      const blob = await downloadBalancesPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "balances_report.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download balances PDF", err);
      alert("Could not download balances PDF. Please try again.");
    }
  }, []);

  const handleSummaryProductSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions, (option) => option.value);
    setSelectedProductIds(values);
  }, []);

  const handleDailyProductSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions, (option) => option.value);
    setDailyProductIds(values);
  }, []);

  const handleSummaryCustomerSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions, (option) => option.value);
    setSelectedCustomerIds(values);
  }, []);

  const handleDailyCustomerSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions, (option) => option.value);
    setDailyCustomerIds(values);
  }, []);

  const handleRunCustomReport = useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      if (event) {
        event.preventDefault();
      }
      const nextParams: any = {
        dataset: customDataset,
        groupBy: customGroupBy,
      };
      if (customAggregateBy) nextParams.aggregateBy = customAggregateBy;
      if (customFrom) nextParams.from = customFrom;
      if (customTo) nextParams.to = customTo;
      if (customCustomerId) nextParams.customerId = Number(customCustomerId);
      if (customJobSiteId) nextParams.jobSiteId = Number(customJobSiteId);
      if (customSupplierId) nextParams.supplierId = Number(customSupplierId);
      if (customProductId) nextParams.productId = Number(customProductId);
      if (customPaymentType) nextParams.paymentType = customPaymentType;
      if (customReceiptType) nextParams.receiptType = customReceiptType;
      if (customDebrisStatus) nextParams.status = customDebrisStatus;
      if (customPayrollType) nextParams.payrollType = customPayrollType;
      if (customInventoryType) nextParams.inventoryType = customInventoryType;
      if (customIsPaid === "true" || customIsPaid === "false") {
        nextParams.isPaid = customIsPaid === "true";
      }
      if (customLimit && !Number.isNaN(Number(customLimit))) {
        nextParams.limit = Number(customLimit);
      }
      setCustomParams(nextParams);
    },
    [
      customDataset,
      customGroupBy,
      customFrom,
      customTo,
      customCustomerId,
      customJobSiteId,
      customSupplierId,
      customProductId,
      customPaymentType,
      customReceiptType,
      customDebrisStatus,
      customPayrollType,
      customInventoryType,
      customIsPaid,
      customLimit,
    ],
  );

  const renderCustomGroups = () => {
    if (!customReport || !customReport.groups || customReport.groups.length === 0) {
      return null;
    }
    const groups = customReport.groups;
    if (customReport.dataset === "receipts") {
      return (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Count</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: CustomReportGroup) => (
              <tr key={group.key}>
                <td>{group.label ?? group.key}</td>
                <td>{group.count.toLocaleString()}</td>
                <td>{formatCurrency(group.total ?? 0)}</td>
                <td>{formatCurrency(group.amountPaid ?? 0)}</td>
                <td>{formatCurrency(group.outstanding ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (customReport.dataset === "payments" || customReport.dataset === "payroll") {
      return (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Count</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: CustomReportGroup) => (
              <tr key={group.key}>
                <td>{group.label ?? group.key}</td>
                <td>{group.count.toLocaleString()}</td>
                <td>{formatCurrency(group.totalAmount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (customReport.dataset === "debris") {
      return (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Loads</th>
              <th>Volume</th>
              <th>Removal cost</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: CustomReportGroup) => (
              <tr key={group.key}>
                <td>{group.label ?? group.key}</td>
                <td>{group.count.toLocaleString()}</td>
                <td>{(group.totalVolume ?? 0).toFixed(3)} m³</td>
                <td>{formatCurrency(group.totalRemovalCost ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (customReport.dataset === "inventory") {
      return (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Entries</th>
              <th>Quantity</th>
              <th>Total cost</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: CustomReportGroup) => (
              <tr key={group.key}>
                <td>{group.label ?? group.key}</td>
                <td>{group.count.toLocaleString()}</td>
                <td>{formatNumber(group.totalQuantity ?? 0)}</td>
                <td>{formatCurrency(group.totalCost ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return null;
  };

  const renderCustomTable = () => {
    if (!customReport || !customReport.items) {
      return null;
    }
    if (customReport.items.length === 0) {
      return <p>No rows match these filters yet.</p>;
    }
    switch (customReport.dataset) {
      case "receipts": {
        return (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Job site</th>
                <th>Type</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {(customReport.items as any[]).map((item) => {
                const receipt = item as any;
                const outstanding = Math.max((receipt.total ?? 0) - (receipt.amountPaid ?? 0), 0);
                const itemSummary =
                  receipt.items && receipt.items.length > 0
                    ? receipt.items
                        .map((line: any) => `${line.product} (${formatNumber(line.quantity)})`)
                        .join(", ")
                    : "—";
                return (
                  <tr key={receipt.id}>
                    <td>{formatDate(receipt.date)}</td>
                    <td>{receipt.receiptNo ?? `#${receipt.id}`}</td>
                    <td>{receipt.customer ?? "Walk-in"}</td>
                    <td>{receipt.jobSite ?? "—"}</td>
                    <td>{receipt.type}</td>
                    <td>{formatCurrency(receipt.total ?? 0)}</td>
                    <td>{formatCurrency(receipt.amountPaid ?? 0)}</td>
                    <td>{formatCurrency(outstanding)}</td>
                    <td style={{ maxWidth: 240, whiteSpace: "normal" }}>{itemSummary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      case "payments": {
        return (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Counterparty</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {(customReport.items as any[]).map((item) => {
                const payment = item as any;
                const counterparty =
                  payment.customer ??
                  payment.supplier ??
                  payment.payrollEmployee ??
                  (payment.debrisVolume ? `Debris (${payment.debrisVolume} m³)` : "—");
                return (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.date)}</td>
                    <td>{humanizePaymentType(payment.type)}</td>
                    <td>{formatCurrency(payment.amount ?? 0)}</td>
                    <td>{counterparty}</td>
                    <td>{payment.description ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      case "payroll": {
        return (
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Quantity</th>
                <th>Period</th>
                <th>Paid at</th>
              </tr>
            </thead>
            <tbody>
              {(customReport.items as any[]).map((item) => {
                const entry = item as any;
                return (
                  <tr key={entry.id}>
                    <td>{entry.employee}</td>
                    <td>{entry.type}</td>
                    <td>{formatCurrency(entry.amount ?? 0)}</td>
                    <td>{entry.quantity ?? "—"}</td>
                    <td>
                      {formatDate(entry.periodStart)} → {formatDate(entry.periodEnd)}
                    </td>
                    <td>{entry.paidAt ? formatDate(entry.paidAt) : "Unpaid"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      case "debris": {
        return (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Volume</th>
                <th>Removal cost</th>
                <th>Customer</th>
                <th>Removal payment</th>
              </tr>
            </thead>
            <tbody>
              {(customReport.items as any[]).map((item) => {
                const entry = item as any;
                return (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.date)}</td>
                    <td>{entry.status}</td>
                    <td>{(entry.volume ?? 0).toFixed(3)} m³</td>
                    <td>{formatCurrency(entry.removalCost ?? 0)}</td>
                    <td>{entry.customer ?? "Walk-in"}</td>
                    <td>{entry.removalPaymentId ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      case "inventory": {
        return (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Product</th>
                <th>Supplier</th>
                <th>Quantity</th>
                <th>Total cost</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {(customReport.items as any[]).map((item) => {
                const entry = item as any;
                return (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.entryDate)}</td>
                    <td>{entry.type}</td>
                    <td>{entry.product}</td>
                    <td>{entry.supplier ?? "—"}</td>
                    <td>{formatNumber(entry.quantity ?? 0)}</td>
                    <td>{formatCurrency(entry.totalCost ?? 0)}</td>
                    <td>{entry.isPaid ? "Yes" : "No"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      default:
        return null;
    }
  };

  return (
    <section>
      <header>
        <h2>Reports & Analytics</h2>
        <p>Dive into revenue, costs, inventory, debris, and stone production KPI's.</p>
      </header>

      <div
        className="section-card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)" }}>Quick navigation</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" className="ghost-button" onClick={() => scrollToSection(summarySectionRef)}>
              Summary insights
            </button>
            <button type="button" className="ghost-button" onClick={() => scrollToSection(customSectionRef)}>
              Custom builder
            </button>
            <button type="button" className="ghost-button" onClick={() => scrollToSection(dailySectionRef)}>
              Daily snapshot
            </button>
          </div>
          {dailyHighlightCards.length > 0 ? (
            <div className="stat-grid" style={{ marginTop: 16 }}>
              {dailyHighlightCards.map((card) => (
                <div key={card.label} className="stat-card">
                  <h4>{card.label}</h4>
                  <strong>{card.value}</strong>
                  <span className="badge">{card.sublabel}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {quickFilterBadges.map((badge) => (
            <span
              key={badge.label}
              className="badge"
              style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
            >
              <small style={{ fontSize: 10, textTransform: "uppercase" }}>{badge.label}</small>
              {badge.value}
            </span>
          ))}
        </div>
      </div>

      <div className="report-toolbar">
        <div className="report-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleDownloadSummary}
            disabled={!summary}
          >
            Download CSV snapshot
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleShareSnapshot}
            disabled={!summary}
          >
            Share via email
          </button>
          <button type="button" className="ghost-button" onClick={handleDownloadPdf} disabled={false}>
            Download PDF (credits/debits & inventory)
          </button>
          <button type="button" className="ghost-button" onClick={handleDownloadBalancesPdf} disabled={false}>
            Download Balances PDF (customers, suppliers, inventory)
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => scrollToSection(dailySectionRef)}
          >
            Jump to daily snapshot
          </button>
        </div>
        <div className="report-meta">
          <span>Current range: {rangeLabel}</span>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Filters</h3>
        <div className="form-grid three-columns">
          <label>
            Timeframe
            <select
              value={timeframe}
              onChange={(event) => {
                setTimeframe(event.target.value);
                if (event.target.value !== "custom") {
                  const defaults = getDefaultRange(event.target.value);
                  setCustomStart(defaults.start ?? "");
                  setCustomEnd(defaults.end ?? "");
                }
              }}
            >
              {timeframeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {timeframe === "custom" ? (
            <>
              <label>
                Start date
                <input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Start date
                <input type="date" value={range.start ?? ""} readOnly />
              </label>
              <label>
                End date
                <input type="date" value={range.end ?? ""} readOnly />
              </label>
            </>
          )}

          <label>
            Group by
            <select value={derivedGroupBy} onChange={(event) => setGroupBy(event.target.value as any)}>
              {groupByOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="full-width">
            Products (optional)
            <select
              multiple
              value={selectedProductIds}
              onChange={handleSummaryProductSelect}
              disabled={productsLoading}
            >
              {productsLoading ? (
                <option>Loading products…</option>
              ) : products.length === 0 ? (
                <option>No products available</option>
              ) : (
                products.map((product) => (
                  <option key={product.id} value={product.id.toString()}>
                    {product.name}
                  </option>
                ))
              )}
            </select>
            <small>Select one or more products to focus metrics on specific materials.</small>
          </label>
          <label className="full-width">
            Customers (optional)
            <select
              multiple
              value={selectedCustomerIds}
              onChange={handleSummaryCustomerSelect}
              disabled={customersLoading}
            >
              {customersLoading ? (
                <option>Loading customers…</option>
              ) : customers.length === 0 ? (
                <option>No customers available</option>
              ) : (
                customers.map((customer) => (
                  <option key={customer.id} value={customer.id.toString()}>
                    {customer.name}
                  </option>
                ))
              )}
            </select>
            <small>Limit the report to one or more specific customers.</small>
          </label>
        </div>
      </div>

      <div className="section-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Daily snapshot filters</h3>
        <div className="form-grid three-columns">
          <label>
            Report date
            <input
              type="date"
              value={dailyDate}
              max={todayIso()}
              onChange={(event) => setDailyDate(event.target.value)}
            />
          </label>
          <label className="full-width">
            Products (optional)
            <select
              multiple
              value={dailyProductIds}
              onChange={handleDailyProductSelect}
              disabled={productsLoading}
            >
              {productsLoading ? (
                <option>Loading products…</option>
              ) : products.length === 0 ? (
                <option>No products available</option>
              ) : (
                products.map((product) => (
                  <option key={product.id} value={product.id.toString()}>
                    {product.name}
                  </option>
                ))
              )}
            </select>
            <small>Optional filter to limit the daily report to specific materials.</small>
          </label>
          <label className="full-width">
            Customers (optional)
            <select
              multiple
              value={dailyCustomerIds}
              onChange={handleDailyCustomerSelect}
              disabled={customersLoading}
            >
              {customersLoading ? (
                <option>Loading customers…</option>
              ) : customers.length === 0 ? (
                <option>No customers available</option>
              ) : (
                customers.map((customer) => (
                  <option key={customer.id} value={customer.id.toString()}>
                    {customer.name}
                  </option>
                ))
              )}
            </select>
            <small>Optional filter to limit the daily report to specific customers.</small>
          </label>
        </div>
      </div>

      <div ref={customSectionRef} />
      <div className="section-card" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Custom report builder</h3>
            <p style={{ margin: 0, color: "var(--color-muted)" }}>
              Choose any dataset, slice by dates or parties, and group the output. Great for ad-hoc questions.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={() => handleRunCustomReport()}>
            Run report
          </button>
        </div>

        <form className="form-grid three-columns" style={{ marginTop: 12 }} onSubmit={handleRunCustomReport}>
          <label>
            Dataset
            <select
              value={customDataset}
              onChange={(event) => setCustomDataset(event.target.value as CustomReportDataset)}
            >
              <option value="receipts">Receipts</option>
              <option value="payments">Payments</option>
              <option value="payroll">Payroll</option>
              <option value="debris">Debris</option>
              <option value="inventory">Inventory</option>
            </select>
          </label>
          <label>
            From
            <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
          </label>
          <label>
            Group by
            <select
              value={customGroupBy}
              onChange={(event) => setCustomGroupBy(event.target.value as "day" | "week" | "month")}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label>
            Rollup by
            <select value={customAggregateBy} onChange={(event) => setCustomAggregateBy(event.target.value)}>
              <option value="">Timeline (default)</option>
              {customDataset === "receipts" && (
                <>
                  <option value="customer">Customer</option>
                  <option value="jobsite">Job site</option>
                  <option value="product">Product</option>
                </>
              )}
              {customDataset === "payments" && (
                <>
                  <option value="customer">Customer</option>
                  <option value="supplier">Supplier</option>
                </>
              )}
              {customDataset === "payroll" && <option value="employee">Employee</option>}
              {customDataset === "debris" && <option value="customer">Customer</option>}
              {customDataset === "inventory" && (
                <>
                  <option value="supplier">Supplier</option>
                  <option value="product">Product</option>
                </>
              )}
            </select>
          </label>
          <label>
            Rows limit
            <input
              type="number"
              min={1}
              max={2000}
              value={customLimit}
              onChange={(event) => setCustomLimit(event.target.value)}
            />
          </label>
          {(customDataset === "receipts" || customDataset === "inventory") && (
            <label>
              Paid status
              <select value={customIsPaid} onChange={(event) => setCustomIsPaid(event.target.value as any)}>
                <option value="">All</option>
                <option value="true">Paid</option>
                <option value="false">Unpaid</option>
              </select>
            </label>
          )}

          {(customDataset === "receipts" || customDataset === "payments" || customDataset === "debris") && (
            <label>
              Customer
              <select value={customCustomerId} onChange={(event) => setCustomCustomerId(event.target.value)}>
                <option value="">All</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {customDataset === "receipts" && (
            <>
              <label>
                Job site
                <select value={customJobSiteId} onChange={(event) => setCustomJobSiteId(event.target.value)}>
                  <option value="">All</option>
                  {jobSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Receipt type
                <select value={customReceiptType} onChange={(event) => setCustomReceiptType(event.target.value as any)}>
                  <option value="">All</option>
                  <option value="NORMAL">Normal</option>
                  <option value="TVA">TVA</option>
                </select>
              </label>
            </>
          )}

          {(customDataset === "receipts" || customDataset === "inventory") && (
            <label>
              Product
              <select value={customProductId} onChange={(event) => setCustomProductId(event.target.value)}>
                <option value="">All</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(customDataset === "payments" || customDataset === "inventory") && (
            <label>
              Supplier
              <select value={customSupplierId} onChange={(event) => setCustomSupplierId(event.target.value)}>
                <option value="">All</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {customDataset === "payments" && (
            <label>
              Payment type
              <select
                value={customPaymentType}
                onChange={(event) => setCustomPaymentType(event.target.value as PaymentType | "")}
              >
                <option value="">All</option>
                {[
                  "GENERAL_EXPENSE",
                  "SUPPLIER",
                  "RECEIPT",
                  "CUSTOMER_PAYMENT",
                  "PAYROLL_SALARY",
                  "PAYROLL_PIECEWORK",
                  "PAYROLL_RUN",
                  "DEBRIS_REMOVAL",
                ].map(
                  (type) => (
                    <option key={type} value={type}>
                      {humanizePaymentType(type)}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}

          {customDataset === "payroll" && (
            <label>
              Payroll type
              <select
                value={customPayrollType}
                onChange={(event) => setCustomPayrollType(event.target.value as PayrollType | "")}
              >
                <option value="">All</option>
                <option value="SALARY">Salary</option>
                <option value="PIECEWORK">Piecework</option>
              </select>
            </label>
          )}

          {customDataset === "debris" && (
            <label>
              Debris status
              <select
                value={customDebrisStatus}
                onChange={(event) => setCustomDebrisStatus(event.target.value as DebrisStatus | "")}
              >
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="REMOVED">Removed</option>
              </select>
            </label>
          )}

          {customDataset === "inventory" && (
            <label>
              Inventory type
              <select
                value={customInventoryType}
                onChange={(event) => setCustomInventoryType(event.target.value as InventoryEntryType | "")}
              >
                <option value="">All</option>
                <option value="PURCHASE">Purchase</option>
                <option value="PRODUCTION">Production</option>
              </select>
            </label>
          )}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button type="submit" className="primary-button">
              Apply filters
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setCustomFrom("");
                setCustomTo("");
                setCustomCustomerId("");
                setCustomJobSiteId("");
                setCustomSupplierId("");
                setCustomProductId("");
                setCustomPaymentType("");
                setCustomReceiptType("");
                setCustomDebrisStatus("");
                setCustomPayrollType("");
                setCustomInventoryType("");
                setCustomIsPaid("");
                setCustomLimit("500");
                setCustomAggregateBy("");
              }}
            >
              Clear
            </button>
          </div>
        </form>

        <div style={{ marginTop: 16 }}>
          {customReportQuery.isLoading ? (
            <p>Loading custom report…</p>
          ) : customReportQuery.error ? (
            <p className="error-text">Failed to load report. Adjust the filters and try again.</p>
          ) : customReport ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ color: "var(--color-muted)" }}>
                  {humanizeDataset(customReport.dataset)} ·{" "}
                  {customParams.aggregateBy
                    ? `Grouped by ${customParams.aggregateBy}`
                    : `Timeline (${customParams.groupBy ?? "day"})`}
                </span>
                <button type="button" className="ghost-button" onClick={handleDownloadCustomCsv}>
                  Download CSV
                </button>
              </div>
              {customSummaryCards.length > 0 ? (
                <div className="stat-grid" style={{ marginBottom: 12 }}>
                  {customSummaryCards.map((card) => (
                    <div key={card.label} className="stat-card">
                      <h4>{card.label}</h4>
                      <strong>{card.value}</strong>
                      <span className="badge">{humanizeDataset(customReport.dataset)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {customReport.groups && customReport.groups.length > 0 ? (
                <div style={{ overflowX: "auto", marginBottom: 12 }}>{renderCustomGroups()}</div>
              ) : null}
              <div style={{ overflowX: "auto" }}>{renderCustomTable()}</div>
            </>
          ) : null}
        </div>
      </div>

      <div ref={summarySectionRef} />
      {summaryQuery.isLoading ? (
        <p>Loading report…</p>
      ) : summaryQuery.error ? (
        <p className="error-text">Failed to load report. Adjust filters and try again.</p>
      ) : summary ? (
        <>
          {isSummaryProductFilterActive ? (
            <div
              style={{
                backgroundColor: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>Material filter enabled.</strong>{" "}
                <span>
                  Showing performance for:{" "}
                  {selectedSummaryProductNames.length > 0
                    ? selectedSummaryProductNames.join(", ")
                    : `${selectedProductIdsNumbers.length} products`}
                  .
                </span>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedProductIds([])}
              >
                Clear filter
              </button>
            </div>
          ) : null}
          {isSummaryCustomerFilterActive ? (
            <div
              style={{
                backgroundColor: "#fefce8",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>Customer filter enabled.</strong>{" "}
                <span>
                  Showing results for{" "}
                  {selectedSummaryCustomerNames.length > 0
                    ? selectedSummaryCustomerNames.join(", ")
                    : `${selectedCustomerIdsNumbers.length} customers`}
                  .
                </span>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedCustomerIds([])}
              >
                Clear customer filter
              </button>
            </div>
          ) : null}
          {isSummaryCustomerFilterActive ? (
            <div
              style={{
                backgroundColor: "#fefce8",
                border: "1px solid #fde68a",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>Customer filter enabled.</strong>{" "}
                <span>
                  Showing activity for:{" "}
                  {selectedSummaryCustomerNames.length > 0
                    ? selectedSummaryCustomerNames.join(", ")
                    : `${selectedCustomerIdsNumbers.length} customers`}
                  .
                </span>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSelectedCustomerIds([])}
              >
                Clear customer filter
              </button>
            </div>
          ) : null}

          <div className="report-highlight-grid">
            {highlightStats.map((stat) => (
              <div key={stat.label} className="stat-card">
                <h4>{stat.label}</h4>
                <strong>{stat.value}</strong>
                {stat.sublabel ? (
                  <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                    {stat.sublabel}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="report-grid">
            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Revenue & Receivables</h3>
              <ul>
                <li>Total sales: {formatCurrency(summary.revenue.totalSales)}</li>
                {summary.revenue.filteredSales !== undefined && isSummaryProductFilterActive ? (
                  <li>
                    Filtered sales: {formatCurrency(summary.revenue.filteredSales)} (selected materials)
                  </li>
                ) : null}
                <li>Cash collected: {formatCurrency(summary.revenue.totalCashCollected)}</li>
                <li>Average receipt: {formatCurrency(summary.revenue.averageReceiptValue)}</li>
                <li>Outstanding receivables: {formatCurrency(summary.revenue.outstandingAmount)}</li>
              </ul>
            </div>
            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Customer receivables</h3>
              {summary.receivables?.customers?.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th style={{ textAlign: "right" }}>Outstanding</th>
                        <th style={{ textAlign: "right" }}>30+ days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.receivables.customers.map((row) => (
                        <tr
                          key={row.customerId}
                          style={row.isOverdue ? { backgroundColor: "#fef2f2" } : undefined}
                        >
                          <td>
                            {row.customerName}
                            {row.isOverdue ? (
                              <span
                                style={{
                                  marginLeft: 8,
                                  padding: "2px 6px",
                                  borderRadius: 999,
                                  backgroundColor: "#dc2626",
                                  color: "#fff",
                                  fontSize: "0.7rem",
                                  textTransform: "uppercase",
                                }}
                              >
                                Overdue
                              </span>
                            ) : null}
                          </td>
                          <td style={{ textAlign: "right" }}>{formatCurrency(row.outstanding)}</td>
                          <td style={{ textAlign: "right" }}>
                            {row.overdueOutstanding > 0 ? (
                              <span title={`Oldest balance ${row.maxDaysOutstanding} days`}>
                                {formatCurrency(row.overdueOutstanding)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No open balances for customers in this period.</p>
              )}
            </div>

            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Purchases & Payables</h3>
              <ul>
                <li>Purchases this period: {formatCurrency(summary.purchases.totalPurchaseCost)}</li>
                <li>Outstanding payables: {formatCurrency(summary.purchases.outstandingPayablesTotal)}</li>
                <li>Suppliers used: {summary.purchases.purchasesBySupplier.length}</li>
              </ul>
              {summary.purchases.purchasesBySupplier.length > 0 ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Supplier</th>
                        <th>Cost</th>
                        <th>Entries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.purchases.purchasesBySupplier.map((row) => (
                        <tr key={row.supplier}>
                          <td>{row.supplier}</td>
                          <td>{formatCurrency(row.totalCost)}</td>
                          <td>{row.entries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No purchases recorded in this period.</p>
              )}
            </div>
            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Purchases by product</h3>
              {purchasesByProduct.length > 0 ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Total cost</th>
                        <th>Avg. unit cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasesByProduct.map((row) => (
                        <tr key={row.productId}>
                          <td>{row.product}</td>
                          <td>{formatNumber(row.quantity)}</td>
                          <td>{formatCurrency(row.totalCost)}</td>
                          <td>
                            {row.averageUnitCost !== null
                              ? formatCurrency(row.averageUnitCost)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No purchases recorded in this period.</p>
              )}
            </div>
            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Recent inventory buys</h3>
              {recentInventoryPurchases.length > 0 ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInventoryPurchases.map((row) => (
                        <tr key={row.id}>
                          <td>{new Date(row.entryDate).toLocaleDateString()}</td>
                          <td>{row.supplier}</td>
                          <td>{row.product}</td>
                          <td>{formatNumber(row.quantity)}</td>
                          <td>{formatCurrency(row.totalCost)}</td>
                          <td>
                            {row.isPaid ? "Paid" : "Unpaid"}
                            {row.tvaEligible ? " • TVA" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No recent inventory purchases in this period.</p>
              )}
            </div>

            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Material sales</h3>
              {summary.materialSales.length === 0 ? (
                <p>No sales recorded for this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Revenue</th>
                        <th>Avg sale</th>
                        <th>Avg cost</th>
                        <th>Profit/unit</th>
                        <th>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.materialSales.map((row) => (
                        <tr key={row.productId}>
                          <td>{row.productName}</td>
                          <td>{formatNumber(row.quantity)}</td>
                          <td>{formatCurrency(row.revenue)}</td>
                          <td>{formatOptionalCurrency(row.averageSalePrice)}</td>
                          <td>{formatOptionalCurrency(row.averageCost)}</td>
                          <td>{formatOptionalCurrency(row.profitPerUnit)}</td>
                          <td>{formatPercentage(row.profitMargin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Revenue trend</h3>
              <RevenueTrendChart data={timelineSeries} formatCurrency={formatCurrency} />
            </div>

            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Sales timeline ({derivedGroupBy})</h3>
              {summary.salesTimeline.length === 0 ? (
                <p>No sales recorded for this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Top materials</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.salesTimeline.map((row) => (
                        <tr key={row.period}>
                          <td>{row.period}</td>
                          <td>
                            {row.products
                              .map(
                                (product) =>
                                  `${product.productName}: ${formatNumber(product.quantity)} units (${formatCurrency(product.revenue)})`,
                              )
                              .join(" • ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Outstanding supplier purchases</h3>
              {summary.purchases.outstanding.length === 0 ? (
                <p>All purchase entries are marked as paid.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Product</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.purchases.outstanding.map((row) => (
                        <tr key={row.id}>
                          <td>{new Date(row.entryDate).toLocaleDateString()}</td>
                          <td>{row.supplier}</td>
                          <td>{row.product}</td>
                          <td>
                            {row.totalCost !== null && row.totalCost !== undefined
                              ? formatCurrency(row.totalCost)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Inventory snapshot</h3>
              {summary.inventory.snapshot.length === 0 ? (
                <p>No products found.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>On hand</th>
                        <th>Unit</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.inventory.snapshot.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{formatNumber(product.stockQty)}</td>
                          <td>{product.unit}</td>
                          <td>
                            {product.unitPrice !== null && product.unitPrice !== undefined
                              ? formatCurrency(product.unitPrice)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Debris summary</h3>
              <ul>
                <li>On site: {formatNumber(summary.debris.onHandVolume)} m³</li>
                <li>Dropped off this period: {formatNumber(summary.debris.droppedVolume)} m³</li>
                <li>Removed this period: {formatNumber(summary.debris.removedVolume)} m³</li>
                <li>Removal spend: {formatCurrency(summary.debris.removalCost)}</li>
              </ul>
            </div>

            <div className="section-card report-card">
              <h3 style={{ marginTop: 0 }}>Stone production (piece rate)</h3>
              <ul>
                <li>Total stones produced: {formatNumber(summary.stoneProduction.totalUnits)}</li>
              </ul>
              {summary.stoneProduction.productionByDate.length > 0 ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.stoneProduction.productionByDate.map((row) => (
                        <tr key={row.period}>
                          <td>{row.period}</td>
                          <td>{formatNumber(row.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No stone production recorded.</p>
              )}
            </div>

            <div className="section-card report-card wide">
              <h3 style={{ marginTop: 0 }}>Stone production entries</h3>
              {summary.stoneProduction.entries.length === 0 ? (
                <p>No stone production entries for this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Product</th>
                        <th>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.stoneProduction.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{new Date(entry.date).toLocaleDateString()}</td>
                          <td>{entry.product}</td>
                          <td>{formatNumber(entry.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <p>No data available for the selected range.</p>
      )}

      <div style={{ marginTop: 48 }}>
        <header>
          <h3>Daily activity overview</h3>
          <p>
            Everything logged on {dailyDateLabel || dailyDate || "the selected day"}
            {hasDailyProductFilter ? " for your chosen materials." : "."}
          </p>
        </header>

        <div className="report-toolbar">
          <div className="report-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleDownloadDailyReceipts}
              disabled={!dailyReport || dailyReport.receipts.length === 0}
            >
              Export receipts CSV
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleDownloadDailyPayments}
              disabled={!dailyReport || dailyReport.payments.length === 0}
            >
              Export payments CSV
            </button>
          </div>
          <div className="report-meta">
            <span>Selected date: {dailyDateLabel || dailyDate || "—"}</span>
          </div>
        </div>

      <div ref={dailySectionRef} style={{ marginTop: 8 }} />
      {dailyReportQuery.isLoading ? (
          <p>Loading daily report…</p>
        ) : dailyReportQuery.isError ? (
          <p className="error-text">Failed to load the daily report. Adjust filters and retry.</p>
        ) : dailyReport ? (
          <>
            {hasDailyProductFilter ? (
              <div
                style={{
                  backgroundColor: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 24,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <strong>Daily filter enabled.</strong>{" "}
                  <span>
                    Focused on:{" "}
                    {selectedDailyProductNames.length > 0
                      ? selectedDailyProductNames.join(", ")
                      : `${dailyProductIdsNumbers.length} products`}
                    .
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setDailyProductIds([])}
                >
                  Clear daily filter
                </button>
              </div>
            ) : null}

            <div className="report-highlight-grid" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <h4>Receipts created</h4>
                <strong>{formatNumber(dailyReport.totals.receiptsCount)}</strong>
                <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                  Total receipts captured for the day
                </p>
              </div>
              <div className="stat-card">
                <h4>Total sales</h4>
                <strong>{formatCurrency(dailyReport.totals.totalSales)}</strong>
                <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                  Cash collected {formatCurrency(dailyReport.totals.cashCollected)}
                </p>
              </div>
              <div className="stat-card">
                <h4>Average receipt</h4>
                <strong>{formatCurrency(dailyReport.totals.averageReceiptValue)}</strong>
                <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                  Based on {formatNumber(dailyReport.totals.receiptsCount)} receipts
                </p>
              </div>
              {hasDailyProductFilter ? (
                <div className="stat-card">
                  <h4>Filtered sales</h4>
                  <strong>{formatCurrency(dailyReport.totals.filteredSales)}</strong>
                  <p style={{ margin: "6px 0 0", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                    Revenue from the selected materials
                  </p>
                </div>
              ) : null}
            </div>

            <div className="report-grid">
              <div className="section-card report-card wide">
                <h3 style={{ marginTop: 0 }}>Receipts</h3>
                {dailyReport.receipts.length === 0 ? (
                  <p>No receipts recorded for this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Receipt #</th>
                          <th>Timestamp</th>
                          <th>Customer / Walk-in</th>
                          <th>Total</th>
                          {hasDailyProductFilter ? <th>Filtered total</th> : null}
                          <th>Paid</th>
                          <th>Balance</th>
                          <th>Items</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.receipts.map((receipt) => {
                          const total = Number(receipt.total ?? 0);
                          const paid = Number(receipt.amountPaid ?? 0);
                          const balance = total - paid;
                          const filtered = receipt.filteredTotal ?? null;
                          const itemsSummary =
                            receipt.items.length === 0
                              ? "—"
                              : receipt.items
                                  .map((item) => {
                                    const quantity = item.displayQuantity ?? item.quantity;
                                    const unit = item.displayUnit ?? item.product.unit ?? "";
                                    const priceText =
                                      item.unitPrice !== null && item.unitPrice !== undefined
                                        ? formatCurrency(item.unitPrice)
                                        : "Pending";
                                    return `${item.product.name}: ${formatNumber(quantity)} ${unit} @ ${priceText}`;
                                  })
                                  .join(" • ");
                          return (
                            <tr key={receipt.id}>
                              <td>{receipt.receiptNo}</td>
                              <td>
                                {formatDate(receipt.date)} {formatTime(receipt.date)}
                              </td>
                              <td>{receipt.customer?.name ?? receipt.walkInName ?? "Walk-in"}</td>
                              <td>{formatCurrency(total)}</td>
                              {hasDailyProductFilter ? (
                                <td>
                                  {filtered !== null ? formatCurrency(filtered) : formatCurrency(0)}
                                </td>
                              ) : null}
                              <td>{formatCurrency(paid)}</td>
                              <td>{formatCurrency(balance)}</td>
                              <td style={{ whiteSpace: "normal" }}>{itemsSummary}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card">
                <h3 style={{ marginTop: 0 }}>Payments</h3>
                {dailyReport.payments.length === 0 ? (
                  <p>No payments were recorded on this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Description</th>
                          <th>Related party</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td>
                              {formatDate(payment.date)} {formatTime(payment.date)}
                            </td>
                            <td>{humanizePaymentType(payment.type)}</td>
                            <td>{formatCurrency(Number(payment.amount ?? 0))}</td>
                            <td>{payment.description ?? "—"}</td>
                            <td>{payment.customer?.name ?? payment.supplier?.name ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card">
                <h3 style={{ marginTop: 0 }}>Inventory purchases</h3>
                {dailyReport.inventory.purchases.length === 0 ? (
                  <p>No purchases logged for this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Supplier</th>
                          <th>Product</th>
                          <th>Quantity</th>
                          <th>Total cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.inventory.purchases.map((purchase) => (
                          <tr key={purchase.id}>
                            <td>
                              {formatDate(purchase.entryDate)} {formatTime(purchase.entryDate)}
                            </td>
                            <td>{purchase.supplier?.name ?? "—"}</td>
                            <td>{purchase.product?.name ?? "—"}</td>
                            <td>{formatNumber(Number(purchase.quantity ?? 0))}</td>
                            <td>
                              {purchase.totalCost !== null && purchase.totalCost !== undefined
                                ? formatCurrency(Number(purchase.totalCost))
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card">
                <h3 style={{ marginTop: 0 }}>Production batches</h3>
                {dailyReport.inventory.production.length === 0 ? (
                  <p>No stone production logged for this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Product</th>
                          <th>Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.inventory.production.map((production) => (
                          <tr key={production.id}>
                            <td>
                              {formatDate(production.entryDate)} {formatTime(production.entryDate)}
                            </td>
                            <td>{production.product?.name ?? "—"}</td>
                            <td>{formatNumber(Number(production.quantity ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card">
                <h3 style={{ marginTop: 0 }}>Diesel logs</h3>
                {dailyReport.dieselLogs.length === 0 ? (
                  <p>No diesel fills captured.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Truck</th>
                          <th>Driver</th>
                          <th>Liters</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.dieselLogs.map((log) => (
                          <tr key={log.id}>
                            <td>
                              {formatDate(log.date)} {formatTime(log.date)}
                            </td>
                            <td>{log.truck?.plateNo ?? "—"}</td>
                            <td>{log.driver?.name ?? "—"}</td>
                            <td>{formatNumber(Number(log.liters ?? 0))}</td>
                            <td>{log.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card">
                <h3 style={{ marginTop: 0 }}>Debris handling</h3>
                {dailyReport.debris.entries.length === 0 ? (
                  <p>No debris entries for this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Customer / Walk-in</th>
                          <th>Volume (m³)</th>
                          <th>Status</th>
                          <th>Removal cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.debris.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td>
                              {formatDate(entry.date)} {formatTime(entry.date)}
                            </td>
                            <td>{entry.customer?.name ?? entry.walkInName ?? "Walk-in"}</td>
                            <td>{formatNumber(Number(entry.volume ?? 0))}</td>
                            <td>{entry.status}</td>
                            <td>
                              {entry.removalCost !== null && entry.removalCost !== undefined
                                ? formatCurrency(Number(entry.removalCost))
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="section-card report-card wide">
                <h3 style={{ marginTop: 0 }}>Payroll & piecework</h3>
                {dailyReport.payrollEntries.length === 0 ? (
                  <p>No payroll items logged on this day.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Employee</th>
                          <th>Type</th>
                          <th>Quantity</th>
                          <th>Amount</th>
                          <th>Stone product</th>
                          <th>Helper</th>
                          <th>Paid?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.payrollEntries.map((entry) => (
                          <tr key={entry.id}>
                            <td>
                              {formatDate(entry.createdAt)} {formatTime(entry.createdAt)}
                            </td>
                            <td>{entry.employee?.name ?? "—"}</td>
                            <td>{entry.type === "PIECEWORK" ? "Piecework" : "Salary"}</td>
                            <td>
                              {entry.quantity !== null && entry.quantity !== undefined
                                ? formatNumber(Number(entry.quantity))
                                : "—"}
                            </td>
                            <td>{formatCurrency(Number(entry.amount ?? 0))}</td>
                            <td>{entry.stoneProduct?.name ?? "—"}</td>
                            <td>{entry.helperEmployee?.name ?? "—"}</td>
                            <td>{entry.payment ? "Yes" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <p>Select a date to view the daily activity report.</p>
        )}
      </div>

      {isAdmin ? (
        <div className="section-card report-card">
          <h3 style={{ marginTop: 0 }}>Receipt & Invoice Activity</h3>
          {receiptActivityQuery.isLoading ? (
            <p>Loading activity…</p>
          ) : receiptActivityQuery.data ? (
            <>
              <h4>Receipts</h4>
              {receiptActivityQuery.data.receipts.length === 0 ? (
                <p>No receipt edits or prints recorded yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Receipt #</th>
                        <th>Customer</th>
                        <th>Prints</th>
                        <th>Edits</th>
                        <th>Deletes</th>
                        <th>Last printed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptActivityQuery.data.receipts.slice(0, 25).map((entry) => (
                        <tr key={entry.receiptId}>
                          <td>{entry.receiptNo}</td>
                          <td>{entry.customerName}</td>
                          <td>{entry.printCount}</td>
                          <td>{entry.updateCount}</td>
                          <td>{entry.deleteCount}</td>
                          <td>{formatDateTime(entry.lastPrintedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ marginTop: 24 }}>Invoices</h4>
              {receiptActivityQuery.data.invoices.length === 0 ? (
                <p>No invoice prints recorded yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Print count</th>
                        <th>Last printed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptActivityQuery.data.invoices.slice(0, 25).map((entry) => (
                        <tr key={entry.customerId}>
                          <td>{entry.customerName}</td>
                          <td>{entry.printCount}</td>
                          <td>{formatDateTime(entry.lastPrintedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p>Unable to load activity.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RevenueTrendChart({
  data,
  formatCurrency,
}: {
  data: TimelineSeriesPoint[];
  formatCurrency: (value: number) => string;
}) {
  if (data.length === 0) {
    return <p>No revenue recorded for this period.</p>;
  }

  const maxRevenue = Math.max(...data.map((point) => point.revenue), 0);
  const safeMax = maxRevenue <= 0 ? 1 : maxRevenue;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {data.map((point) => {
        const widthPercent = (point.revenue / safeMax) * 100;
        return (
          <div key={point.period} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{point.period}</strong>
              <span>{formatCurrency(point.revenue)}</span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: "#e2e8f0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, widthPercent))}%`,
                  background: "linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            {point.topProductName && (
              <small style={{ color: "#475569" }}>
                Top material: {point.topProductName} ({formatCurrency(point.topProductRevenue ?? 0)})
              </small>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ReportsPage;
