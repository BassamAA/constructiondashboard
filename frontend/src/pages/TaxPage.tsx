import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTaxReports,
  type CashRecord,
  type PayrollRecord,
  type PurchaseRecord,
  type SalesRecord,
  type StatementRecord,
  type TrialBalanceRecord,
} from "../api/tax";

const formatCurrency = (value: number | null | undefined) =>
  typeof value === "number" ? `$${value.toFixed(2)}` : "—";

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

type Column<T> = {
  label: string;
  cell: (row: T) => string | number;
};

const renderTable = <T,>(columns: Column<T>[], rows: T[], emptyLabel: string) => {
  if (rows.length === 0) {
    return <p style={{ color: "var(--color-muted)" }}>{emptyLabel}</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((col) => (
                <td key={col.label}>{col.cell(row) as any}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

function exportToCsv<T>(filename: string, columns: Column<T>[], rows: T[]) {
  if (rows.length === 0) return;
  const header = columns.map((col) => `"${col.label.replace(/"/g, '""')}"`).join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const raw = String(col.cell(row) ?? "");
        return `"${raw.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const today = new Date();
const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

export default function TaxPage() {
  const [filters, setFilters] = useState({
    startDate: toDateInputValue(startOfMonth),
    endDate: toDateInputValue(today),
    customerId: "",
    supplierId: "",
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["tax-reports", filters.startDate, filters.endDate, filters.customerId, filters.supplierId],
    queryFn: () =>
      fetchTaxReports({
        startDate: filters.startDate,
        endDate: filters.endDate,
        customerId: filters.customerId || undefined,
        supplierId: filters.supplierId || undefined,
      }),
  });

  const salesColumns: Column<SalesRecord>[] = useMemo(
    () => [
      { label: "Date", cell: (row) => new Date(row.date).toLocaleDateString() },
      { label: "Receipt", cell: (row) => row.receiptNo ?? `#${row.id}` },
      { label: "Customer", cell: (row) => row.customerName },
      { label: "Type", cell: (row) => row.type },
      { label: "Total", cell: (row) => row.total.toFixed(2) },
      { label: "Paid", cell: (row) => row.amountPaid.toFixed(2) },
      { label: "Outstanding", cell: (row) => row.outstanding.toFixed(2) },
    ],
    [],
  );

  const purchaseColumns: Column<PurchaseRecord>[] = useMemo(
    () => [
      { label: "Date", cell: (row) => new Date(row.date).toLocaleDateString() },
      { label: "Supplier", cell: (row) => row.supplierName ?? "—" },
      { label: "Product", cell: (row) => row.productName },
      { label: "Qty", cell: (row) => row.quantity },
      { label: "Unit cost", cell: (row) => row.unitCost ?? 0 },
      { label: "Total cost", cell: (row) => row.totalCost ?? 0 },
      { label: "Paid", cell: (row) => (row.isPaid ? "Yes" : "No") },
      { label: "Notes", cell: (row) => row.notes ?? "" },
    ],
    [],
  );

  const payrollColumns: Column<PayrollRecord>[] = useMemo(
    () => [
      { label: "Period start", cell: (row) => new Date(row.periodStart).toLocaleDateString() },
      { label: "Period end", cell: (row) => new Date(row.periodEnd).toLocaleDateString() },
      { label: "Employee", cell: (row) => row.employeeName },
      { label: "Type", cell: (row) => row.type },
      { label: "Quantity", cell: (row) => row.quantity ?? "" },
      { label: "Amount", cell: (row) => row.amount.toFixed(2) },
      { label: "Notes", cell: (row) => row.notes ?? "" },
    ],
    [],
  );

  const cashColumns: Column<CashRecord>[] = useMemo(
    () => [
      { label: "Date", cell: (row) => new Date(row.date).toLocaleDateString() },
      { label: "Type", cell: (row) => row.type },
      { label: "Amount", cell: (row) => row.amount.toFixed(2) },
      { label: "Description", cell: (row) => row.description ?? "" },
      { label: "Recorded by", cell: (row) => row.createdBy ?? "—" },
    ],
    [],
  );
  const statementColumns = useMemo<Column<StatementRecord>[]>(
    () => [
      { label: "Customer", cell: (row) => row.name },
      { label: "Total billed", cell: (row) => row.total.toFixed(2) },
      { label: "Paid", cell: (row) => row.paid.toFixed(2) },
      { label: "Outstanding", cell: (row) => row.outstanding.toFixed(2) },
    ],
    [],
  );

  const trialColumns = useMemo<Column<TrialBalanceRecord>[]>(
    () => [
      { label: "Account", cell: (row) => row.account },
      { label: "Debit", cell: (row) => row.debit.toFixed(2) },
      { label: "Credit", cell: (row) => row.credit.toFixed(2) },
    ],
    [],
  );


  return (
    <section>
      <header>
        <h2>Tax center</h2>
        <p>
          Export auditable data for sales, purchases, payroll, and cash transactions
          across any date range.
        </p>
      </header>

      <div className="section-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Filters</h3>
        <div className="form-grid two-columns" style={{ maxWidth: 560 }}>
          <label>
            Start date
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, startDate: event.target.value }))
              }
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
            />
          </label>
          <label>
            Customer
            <select
              value={filters.customerId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, customerId: event.target.value }))
              }
            >
              <option value="">All customers</option>
              {data?.customers?.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier
            <select
              value={filters.supplierId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, supplierId: event.target.value }))
              }
            >
              <option value="">All suppliers</option>
              {data?.suppliers?.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ color: "var(--color-muted)", marginTop: 16 }}>
          Reports refresh automatically when you adjust the dates.
        </p>
      </div>

      {error ? (
        <p className="error-text">{(error as Error).message ?? "Failed to load tax reports"}</p>
      ) : isLoading || !data ? (
        <p>Loading tax data…</p>
      ) : (
        <>
          <ReportSection
            title="Sales register"
            description="Official receipts, totals, and outstanding balances."
            columns={salesColumns}
            rows={data.sales}
            emptyLabel="No receipts in the selected range."
            onDownload={() => exportToCsv("sales-register", salesColumns, data.sales)}
            footer={`Total sales: ${formatCurrency(
              data.sales.reduce((sum, row) => sum + row.total, 0),
            )}`}
          />
          <ReportSection
            title="Purchases & expenses"
            description="Supplier invoices recorded through inventory purchases."
            columns={purchaseColumns}
            rows={data.purchases}
            emptyLabel="No purchases recorded in the selected range."
            onDownload={() => exportToCsv("purchase-register", purchaseColumns, data.purchases)}
            footer={`Total cost: ${formatCurrency(
              data.purchases.reduce((sum, row) => sum + (row.totalCost ?? 0), 0),
            )}`}
          />
          <ReportSection
            title="Payroll"
            description="Salary and piecework payouts per employee."
            columns={payrollColumns}
            rows={data.payroll}
            emptyLabel="No payroll entries in the selected range."
            onDownload={() => exportToCsv("payroll-register", payrollColumns, data.payroll)}
            footer={`Total payroll: ${formatCurrency(
              data.payroll.reduce((sum, row) => sum + row.amount, 0),
            )}`}
          />
          <ReportSection
            title="Cash book"
            description="Cash deposits, withdrawals, and owner draws."
            columns={cashColumns}
            rows={data.cash}
            emptyLabel="No cash entries recorded in the selected range."
            onDownload={() => exportToCsv("cash-book", cashColumns, data.cash)}
            footer={`Net cash: ${formatCurrency(
              data.cash.reduce((sum, row) => sum + row.amount, 0),
            )}`}
          />
          <ReportSection
            title="Statement of account"
            description="Customer-level totals and outstanding balances."
            columns={statementColumns}
            rows={data.statementOfAccount}
            emptyLabel="No statement entries for this period."
            onDownload={() =>
              exportToCsv("statement-of-account", statementColumns, data.statementOfAccount)
            }
            footer={`Aggregate outstanding: ${formatCurrency(
              data.statementOfAccount.reduce((sum, row) => sum + row.outstanding, 0),
            )}`}
          />
          <ReportSection
            title="Trial balance"
            description="Debits and credits summary for the selected range."
            columns={trialColumns}
            rows={data.trialBalance}
            emptyLabel="No trial balance rows."
            onDownload={() =>
              exportToCsv("trial-balance", trialColumns, data.trialBalance)
            }
          />
        </>
      )}
    </section>
  );
}

type ReportSectionProps<T> = {
  title: string;
  description: string;
  columns: Column<T>[];
  rows: T[];
  emptyLabel: string;
  onDownload: () => void;
  footer?: string;
};

function ReportSection<T>({
  title,
  description,
  columns,
  rows,
  emptyLabel,
  onDownload,
  footer,
}: ReportSectionProps<T>) {
  return (
    <div className="section-card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          <p style={{ color: "var(--color-muted)", marginBottom: 12 }}>{description}</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onDownload}
          disabled={rows.length === 0}
        >
          Download CSV
        </button>
      </div>
      {rows.length > 0 && (
        <p style={{ color: "var(--color-muted)", marginBottom: 12 }}>
          {rows.length} record{rows.length === 1 ? "" : "s"} found.
        </p>
      )}
      {renderTable(columns, rows, emptyLabel)}
      {footer ? <p style={{ marginTop: 12, fontWeight: 600 }}>{footer}</p> : null}
    </div>
  );
}
