import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchFinanceOverview } from "../api/finance";
import { fetchManualControls, updateManualControls } from "../api/manualControls";
import { apiClient } from "../api/client";
import { fetchCustomers } from "../api/customers";
import { fetchSuppliers } from "../api/suppliers";
import { fetchProducts } from "../api/products";
import { useAuth } from "../context/AuthContext";
import type {
  FinanceCashEntry,
  FinanceLaborPayableEntry,
  FinancePurchasePayableEntry,
  FinancePurchaseDetailEntry,
  FinanceReceiptDetailEntry,
  ManualControlsResponse,
} from "../types";
import { formatMakbas } from "../constants/makbas";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

type ManualControlFieldKey = keyof ManualControlsResponse;

const MANUAL_FIELD_LABELS: Record<ManualControlFieldKey, string> = {
  inventoryValue: "Inventory on hand",
  receivablesTotal: "Money owed to us",
  payablesTotal: "Money we owe",
};

const MANUAL_FIELD_DESCRIPTIONS: Record<ManualControlFieldKey, string> = {
  inventoryValue: "System value is based on live stock counts multiplied by product prices.",
  receivablesTotal: "System value is the sum of every unpaid receipt and partially paid invoice.",
  payablesTotal: "System value is the total of supplier purchases, labor, and payroll still unpaid.",
};

const apiBase =
  (typeof window !== "undefined" && apiClient?.defaults?.baseURL
    ? apiClient.defaults.baseURL.replace(/\/$/, "")
    : import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://localhost:4000");

const CashTable = ({
  title,
  entries,
  total,
}: {
  title: string;
  entries: FinanceCashEntry[];
  total?: number;
}) => (
  <div className="section-card">
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {typeof total === "number" ? (
          <span style={{ fontWeight: 600 }}>{formatCurrency(total)}</span>
        ) : null}
        <span className="badge">{entries.length} entries</span>
      </div>
    </div>
    {entries.length === 0 ? (
      <p style={{ margin: 0 }}>No activity yet.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.label}</td>
                <td>{formatDate(entry.date)}</td>
                <td style={{ textAlign: "right" }}>{formatCurrency(entry.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

type CustomerDebtRow = {
  name: string;
  count: number;
  amount: number;
};

type PayableDebtRow = {
  name: string;
  amount: number;
  sources: string[];
};

const DebtCreditTables = ({
  customerDebts,
  payableDebts,
}: {
  customerDebts: CustomerDebtRow[];
  payableDebts: PayableDebtRow[];
}) => (
  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
    <div className="section-card" style={{ flex: "1 1 320px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0 }}>Customers owing us</h3>
        <span className="badge">{customerDebts.length}</span>
      </div>
      {customerDebts.length === 0 ? (
        <p style={{ margin: 0 }}>No customer balances 🎉</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th style={{ textAlign: "center" }}>Open items</th>
                <th style={{ textAlign: "right" }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {customerDebts.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td style={{ textAlign: "center" }}>{row.count}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <div className="section-card" style={{ flex: "1 1 320px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0 }}>People we owe</h3>
        <span className="badge">{payableDebts.length}</span>
      </div>
      {payableDebts.length === 0 ? (
        <p style={{ margin: 0 }}>All supplier and payroll balances are clear.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payableDebts.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.sources.join(", ")}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </div>
);

const PurchasePayablesTable = ({ entries }: { entries: FinancePurchasePayableEntry[] }) => (
  <div className="section-card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h3 style={{ marginTop: 0 }}>Supplier payables</h3>
      <Link className="ghost-button" to="/inventory">
        Review purchases
      </Link>
    </div>
    {entries.length === 0 ? (
      <p style={{ margin: 0 }}>No supplier payables.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Product</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {entry.supplier}
                  {entry.isManual ? (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Manual
                    </span>
                  ) : null}
                </td>
                <td>{entry.product}</td>
                <td>{formatDate(entry.date)}</td>
                <td style={{ textAlign: "right" }}>{formatCurrency(entry.amount)}</td>
                <td>{entry.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const LaborPayablesTable = ({ entries }: { entries: FinanceLaborPayableEntry[] }) => (
  <div className="section-card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h3 style={{ marginTop: 0 }}>Manufacturing payables</h3>
      <Link className="ghost-button" to="/manufacturing">
        Open manufacturing window
      </Link>
    </div>
    {entries.length === 0 ? (
      <p style={{ margin: 0 }}>No unpaid production runs.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Makbas</th>
              <th>Quantity</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Workers</th>
              <th style={{ textAlign: "right" }}>Helpers</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.product}</td>
                <td>{formatMakbas(entry.productionSite)}</td>
                <td>{entry.quantity.toLocaleString()}</td>
                <td>{formatDate(entry.date)}</td>
                <td style={{ textAlign: "right" }}>
                  {formatCurrency(entry.workerDue)}
                  {entry.workerName ? ` (${entry.workerName})` : ""}
                </td>
                <td style={{ textAlign: "right" }}>
                  {formatCurrency(entry.helperDue)}
                  {entry.helperName ? ` (${entry.helperName})` : ""}
                </td>
                <td style={{ textAlign: "right" }}>{formatCurrency(entry.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const ReceiptDetailTable = ({ entries }: { entries: FinanceReceiptDetailEntry[] }) => (
  <div className="section-card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h3 style={{ marginTop: 0 }}>Receipts for selected customer</h3>
      <span className="badge">{entries.length} receipts</span>
    </div>
    {entries.length === 0 ? (
      <p style={{ margin: 0 }}>No receipts found for this customer.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Date</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th style={{ textAlign: "right" }}>Outstanding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const status =
                entry.isPaid || entry.paid >= entry.total
                  ? "Paid"
                  : entry.paid > 0
                  ? "Partially paid"
                  : "Unpaid";
              return (
                <tr key={entry.id}>
                  <td>{entry.receiptNo}</td>
                  <td>{formatDate(entry.date)}</td>
                  <td>{entry.type ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.total)}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.paid)}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.outstanding)}</td>
                  <td>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const PurchaseDetailTable = ({ entries }: { entries: FinancePurchaseDetailEntry[] }) => (
  <div className="section-card">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h3 style={{ marginTop: 0 }}>Purchases for selected supplier</h3>
      <span className="badge">{entries.length} entries</span>
    </div>
    {entries.length === 0 ? (
      <p style={{ margin: 0 }}>No purchases found for this supplier.</p>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Date</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th style={{ textAlign: "right" }}>Outstanding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const status =
                entry.isPaid || entry.paid >= entry.total
                  ? "Paid"
                  : entry.paid > 0
                  ? "Partially paid"
                  : "Unpaid";
              return (
                <tr key={entry.id}>
                  <td>{entry.product}</td>
                  <td>{formatDate(entry.date)}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.total)}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.paid)}</td>
                  <td style={{ textAlign: "right" }}>{formatCurrency(entry.outstanding)}</td>
                  <td>{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export function FinancePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [allTime, setAllTime] = useState<boolean>(true);
  const [includeInflows, setIncludeInflows] = useState<boolean>(true);
  const [includeOutflows, setIncludeOutflows] = useState<boolean>(true);
  const [includeReceipts, setIncludeReceipts] = useState<boolean>(false);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [customerIdFilter, setCustomerIdFilter] = useState<string>("");
  const [supplierIdFilter, setSupplierIdFilter] = useState<string>("");
  const [productIdFilter, setProductIdFilter] = useState<string>("");
  const [showDetailedSummary, setShowDetailedSummary] = useState<boolean>(false);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });
  const [controlForm, setControlForm] = useState<Record<ManualControlFieldKey, string>>({
    inventoryValue: "",
    receivablesTotal: "",
    payablesTotal: "",
  });
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "finance-overview",
      { start, end, allTime, customerIdFilter, supplierIdFilter, productIdFilter },
    ],
    queryFn: () =>
      fetchFinanceOverview(
        allTime
          ? {
              allTime: true,
              customerId: customerIdFilter || undefined,
              supplierId: supplierIdFilter || undefined,
              productId: productIdFilter || undefined,
            }
          : {
              start: start || undefined,
              end: end || undefined,
              customerId: customerIdFilter || undefined,
              supplierId: supplierIdFilter || undefined,
              productId: productIdFilter || undefined,
            },
      ),
  });
  const {
    data: manualControls,
    isLoading: loadingManualControls,
    error: manualControlsError,
  } = useQuery({
    queryKey: ["manual-controls"],
    queryFn: fetchManualControls,
    enabled: Boolean(isAdmin),
  });

  const manualControlsMutation = useMutation({
    mutationFn: updateManualControls,
    onSuccess: () => {
      setOverrideError(null);
      queryClient.invalidateQueries({ queryKey: ["manual-controls"] });
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
    },
    onError: (err: any) => {
      setOverrideError(err?.response?.data?.error ?? err?.message ?? "Failed to save override");
    },
  });

  useEffect(() => {
    if (manualControls) {
      setControlForm({
        inventoryValue: manualControls.inventoryValue.value?.toString() ?? "",
        receivablesTotal: manualControls.receivablesTotal.value?.toString() ?? "",
        payablesTotal: manualControls.payablesTotal.value?.toString() ?? "",
      });
    }
  }, [manualControls]);

  const handleControlChange = (key: ManualControlFieldKey, value: string) => {
    setControlForm((prev) => ({ ...prev, [key]: value }));
  };

  const applyOverride = (key: ManualControlFieldKey) => {
    const rawValue = controlForm[key];
    const trimmed = rawValue.trim();
    let parsed: number | null;
    if (trimmed.length === 0) {
      parsed = null;
    } else {
      const numericValue = Number(trimmed);
      if (Number.isNaN(numericValue)) {
        setOverrideError("Enter a valid number (e.g. 1250.50)");
        return;
      }
      parsed = numericValue;
    }
    setOverrideError(null);
    manualControlsMutation.mutate({ [key]: parsed });
  };

  const detailedPeriodStats = useMemo(() => {
    if (!data) {
      return null;
    }
    const receipts = data.details?.customerReceipts ?? [];
    const purchases = data.details?.supplierPurchases ?? [];
    const soldTotal = receipts.reduce((sum, r) => sum + (r.total ?? 0), 0);
    const soldPaid = receipts.reduce((sum, r) => sum + (r.paid ?? 0), 0);
    const boughtTotal = purchases.reduce((sum, p) => sum + (p.total ?? 0), 0);
    const boughtPaid = purchases.reduce((sum, p) => sum + (p.paid ?? 0), 0);
    const inflows = data.cash.inflowTotal ?? 0;
    const outflows = data.cash.outflowTotal ?? 0;
    return {
      soldTotal,
      soldPaid,
      soldOutstanding: Math.max(soldTotal - soldPaid, 0),
      boughtTotal,
      boughtPaid,
      boughtOutstanding: Math.max(boughtTotal - boughtPaid, 0),
      inflows,
      outflows,
      netCash: inflows - outflows,
    };
  }, [data]);

  const handleReset = (key: ManualControlFieldKey) => {
    setControlForm((prev) => ({ ...prev, [key]: "" }));
    setOverrideError(null);
    manualControlsMutation.mutate({ [key]: null });
  };

  const manualFieldConfigs = useMemo(() => {
    if (!data) {
      return [];
    }
    const inventory = data.inventory ?? { total: 0, computedTotal: 0, overrideValue: null };
    const receivables = data.receivables ?? {
      total: 0,
      computedTotal: 0,
      overrideValue: null,
      receipts: [],
    };
    const payables = data.payables ?? {
      total: 0,
      purchaseTotal: 0,
      laborTotal: 0,
      payrollTotal: 0,
      computedTotal: 0,
      overrideValue: null,
      purchases: [],
      labor: [],
      payroll: [],
    };
    return [
      {
        key: "inventoryValue" as const,
        computed: inventory.computedTotal,
        overrideValue: inventory.overrideValue,
        detail: `System estimate ${formatCurrency(inventory.computedTotal)}`,
      },
      {
        key: "receivablesTotal" as const,
        computed: receivables.computedTotal,
        overrideValue: receivables.overrideValue,
        detail: `${receivables.receipts.length} open invoices tracked.`,
      },
      {
        key: "payablesTotal" as const,
        computed: payables.computedTotal,
        overrideValue: payables.overrideValue,
        detail: `Suppliers ${formatCurrency(payables.purchaseTotal)} • Labor ${formatCurrency(
          payables.laborTotal,
        )} • Payroll ${formatCurrency(payables.payrollTotal)}`,
      },
    ];
  }, [data]);

  const customerDebtRows = useMemo<CustomerDebtRow[]>(() => {
    if (!data) return [];
    const map = new Map<string, CustomerDebtRow>();
    data.receivables.receipts.forEach((receipt) => {
      const name = receipt.customer || "Walk-in";
      const outstanding = Number(receipt.outstanding ?? 0);
      if (outstanding <= 0) {
        return;
      }
      const existing = map.get(name) ?? { name, count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += outstanding;
      map.set(name, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [data]);

  const payableDebtRows = useMemo<PayableDebtRow[]>(() => {
    if (!data) return [];
    const map = new Map<
      string,
      {
        name: string;
        amount: number;
        sources: Set<string>;
      }
    >();

    const addRow = (name: string, amount: number, source: string) => {
      if (amount <= 0) return;
      const key = name || source;
      const existing =
        map.get(key) ??
        {
          name: name || "Unassigned",
          amount: 0,
          sources: new Set<string>(),
        };
      existing.amount += amount;
      existing.sources.add(source);
      map.set(key, existing);
    };

    data.payables.purchases.forEach((entry) => {
      addRow(entry.supplier, entry.amount, entry.isManual ? "Supplier (manual)" : "Supplier");
    });
    data.payables.labor.forEach((entry) => {
      if (entry.workerDue > 0) {
        addRow(entry.workerName ?? "Production worker", entry.workerDue, "Labor");
      }
      if (entry.helperDue > 0) {
        addRow(entry.helperName ?? "Production helper", entry.helperDue, "Labor");
      }
    });
    data.payables.payroll.forEach((entry) => {
      addRow(entry.employee ?? "Payroll", entry.amount, "Payroll");
    });

    return Array.from(map.values())
      .map((row) => ({
        name: row.name,
        amount: row.amount,
        sources: Array.from(row.sources),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  const cashStats = useMemo(() => {
    if (!data) {
      return null;
    }
    const inventory = data.inventory ?? { total: 0, computedTotal: 0, overrideValue: null };
    const flags = data.displayFlags ?? { displayCash: true, displayReceivables: true, displayPayables: true };
    const stats = [];
    if (flags.displayCash) {
      stats.push({
        label: "Cash on hand",
        value: formatCurrency(data.cash.onHand),
        badge: `Inflow ${formatCurrency(data.cash.inflowTotal)} • Outflow ${formatCurrency(
          data.cash.outflowTotal,
        )}`,
      });
    }
    if (flags.displayReceivables) {
      stats.push({
        label: "Receivables",
        value: formatCurrency(data.receivables.total),
        badge:
          data.receivables.overrideValue !== null
            ? `Manual override • System ${formatCurrency(data.receivables.computedTotal)}`
            : `${data.receivables.receipts.length} open invoices`,
      });
    }
    if (flags.displayPayables) {
      stats.push({
        label: "Payables",
        value: formatCurrency(data.payables.total),
        badge:
          data.payables.overrideValue !== null
            ? `Manual override • System ${formatCurrency(data.payables.computedTotal)}`
            : `Suppliers ${formatCurrency(data.payables.purchaseTotal)} • Manufacturing ${formatCurrency(
                data.payables.laborTotal,
              )} • Payroll ${formatCurrency(data.payables.payrollTotal)}`,
      });
    }
    stats.push({
      label: "Inventory value",
      value: formatCurrency(inventory.total),
      badge:
        inventory.overrideValue !== null
          ? `Manual override • System ${formatCurrency(inventory.computedTotal)}`
          : `System estimate ${formatCurrency(inventory.computedTotal)}`,
    });
    return stats;
  }, [data]);

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h2>Finance</h2>
        <p>One place to inspect every peso entering or leaving the business.</p>
      </header>

      {isLoading ? (
        <p>Loading finance overview…</p>
      ) : error ? (
        <p className="error-text">Failed to load finance overview.</p>
      ) : data && cashStats ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            className="section-card"
            style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div>
              <label style={{ display: "block", fontWeight: 600 }}>Start date</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 600 }}>End date</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={allTime}
                onChange={(e) => {
                  setAllTime(e.target.checked);
                  if (e.target.checked) {
                    setStart("");
                    setEnd("");
                  }
                }}
              />
              All time
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={includeInflows}
                onChange={(e) => setIncludeInflows(e.target.checked)}
              />
              Show inflows
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={includeOutflows}
                onChange={(e) => setIncludeOutflows(e.target.checked)}
              />
              Show outflows
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
              <span style={{ fontWeight: 600 }}>Type filter (optional)</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{ minWidth: 180 }}
              >
                <option value="">All types</option>
                <option value="CUSTOMER_PAYMENT">Customer payments</option>
                <option value="RECEIPT">Receipts</option>
                <option value="SUPPLIER">Supplier payments</option>
                <option value="GENERAL_EXPENSE">General expenses</option>
                <option value="DEBRIS_REMOVAL">Debris removal</option>
                <option value="OWNER_DRAW">Owner draw</option>
                <option value="PAYROLL_SALARY">Payroll salary</option>
                <option value="PAYROLL_PIECEWORK">Payroll piecework</option>
                <option value="PAYROLL_RUN">Payroll run</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
              <span style={{ fontWeight: 600 }}>Customer filter</span>
              <select
                value={customerIdFilter}
                onChange={(e) => setCustomerIdFilter(e.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="">None</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} (#{customer.id})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
              <span style={{ fontWeight: 600 }}>Supplier filter</span>
              <select
                value={supplierIdFilter}
                onChange={(e) => setSupplierIdFilter(e.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="">None</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} (#{supplier.id})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
              <span style={{ fontWeight: 600 }}>Product filter</span>
              <select
                value={productIdFilter}
                onChange={(e) => setProductIdFilter(e.target.value)}
                style={{ minWidth: 220 }}
              >
                <option value="">None</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} (#{product.id})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={includeReceipts}
                onChange={(e) => setIncludeReceipts(e.target.checked)}
              />
              Include paid/unpaid receipts in PDF
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={showDetailedSummary}
                onChange={(e) => setShowDetailedSummary(e.target.checked)}
              />
              Show quick period totals (sold / bought / paid)
            </label>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <button className="ghost-button" onClick={() => refetch()}>
                Apply
              </button>
              <a
                className="secondary-button"
                href={`${apiBase}/reports/exports/cash-ledger-pdf${
                  (() => {
                    const params = new URLSearchParams();
                    if (allTime) {
                      params.set("allTime", "true");
                    } else {
                      if (start) params.set("start", start);
                      if (end) params.set("end", end);
                    }
                    if (!includeInflows) params.set("inflows", "false");
                    if (!includeOutflows) params.set("outflows", "false");
                    if (typeFilter) params.set("types", typeFilter);
                    if (customerIdFilter.trim().length > 0) params.set("customerId", customerIdFilter);
                    if (supplierIdFilter.trim().length > 0) params.set("supplierId", supplierIdFilter);
                    if (productIdFilter.trim().length > 0) params.set("productId", productIdFilter);
                    if (includeReceipts) params.set("receipts", "true");
                    const q = params.toString();
                    return q ? `?${q}` : "";
                  })()
                }`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download cash ledger PDF
              </a>
              <a
                className="secondary-button"
                href={`${apiBase}/finance/period-summary-pdf${
                  (() => {
                    const params = new URLSearchParams();
                    if (allTime) {
                      params.set("allTime", "true");
                    } else {
                      if (start) params.set("start", start);
                      if (end) params.set("end", end);
                    }
                    const q = params.toString();
                    return q ? `?${q}` : "";
                  })()
                }`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download period summary PDF
              </a>
            </div>
          </div>

          {showDetailedSummary && detailedPeriodStats ? (
            <div className="section-card" style={{ marginTop: 12 }}>
              <h3 style={{ marginTop: 0 }}>Period totals (quick view)</h3>
              <div className="stat-grid">
                <div className="stat-card">
                  <h4>Sold</h4>
                  <strong>{formatCurrency(detailedPeriodStats.soldTotal)}</strong>
                  <span className="badge">
                    Paid {formatCurrency(detailedPeriodStats.soldPaid)} · Outstanding{" "}
                    {formatCurrency(detailedPeriodStats.soldOutstanding)}
                  </span>
                </div>
                <div className="stat-card">
                  <h4>Bought</h4>
                  <strong>{formatCurrency(detailedPeriodStats.boughtTotal)}</strong>
                  <span className="badge">
                    Paid {formatCurrency(detailedPeriodStats.boughtPaid)} · Outstanding{" "}
                    {formatCurrency(detailedPeriodStats.boughtOutstanding)}
                  </span>
                </div>
                <div className="stat-card">
                  <h4>Cash in</h4>
                  <strong>{formatCurrency(detailedPeriodStats.inflows)}</strong>
                  <span className="badge">Payments received</span>
                </div>
                <div className="stat-card">
                  <h4>Cash out</h4>
                  <strong>{formatCurrency(detailedPeriodStats.outflows)}</strong>
                  <span className="badge">Payments made</span>
                </div>
                <div className="stat-card">
                  <h4>Net cash</h4>
                  <strong>{formatCurrency(detailedPeriodStats.netCash)}</strong>
                  <span className="badge">{detailedPeriodStats.netCash >= 0 ? "Surplus" : "Deficit"}</span>
                </div>
              </div>
              <p style={{ marginTop: 8, color: "var(--color-muted)" }}>
                Uses the same date filters above (or all time) and mirrors the finance data—no other reports were
                changed.
              </p>
            </div>
          ) : null}

          <div className="stat-grid">
            {cashStats.map((stat) => (
              <div key={stat.label} className="stat-card">
                <h4>{stat.label}</h4>
                <strong>{stat.value}</strong>
                <span className="badge">{stat.badge}</span>
              </div>
            ))}
          </div>

          {isAdmin ? (
            <div className="section-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3 style={{ marginTop: 0 }}>Manual overrides</h3>
                  <p style={{ margin: 0, color: "var(--color-muted)" }}>
                    Override inventory, receivables, or payables when accounting needs to force a number. Leave
                    fields blank to fall back to live system totals.
                  </p>
                </div>
              </div>
              {overrideError ? <p className="error-text">{overrideError}</p> : null}
              {manualControlsError ? (
                <p className="error-text">Unable to load manual override history.</p>
              ) : manualFieldConfigs.length === 0 ? (
                <p>Loading finance summary…</p>
              ) : loadingManualControls ? (
                <p>Loading manual overrides…</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
                  {manualFieldConfigs.map((field) => {
                    const metadata = manualControls?.[field.key];
                    const lastUpdated = metadata?.updatedAt
                      ? new Date(metadata.updatedAt).toLocaleString()
                      : null;
                    const updatedByLabel = metadata?.updatedBy
                      ? metadata.updatedBy.name ?? metadata.updatedBy.email
                      : null;
                    return (
                      <div
                        key={field.key}
                        style={{
                          border: "1px solid var(--color-border)",
                          borderRadius: 12,
                          padding: 16,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <strong>{MANUAL_FIELD_LABELS[field.key]}</strong>
                  <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14 }}>
                    {MANUAL_FIELD_DESCRIPTIONS[field.key]}
                  </p>
                  <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 13 }}>{field.detail}</p>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Current value:{" "}
                    <strong>
                      {formatCurrency(field.overrideValue !== null ? field.overrideValue : field.computed)}
                    </strong>
                  </p>
                  {field.overrideValue !== null ? (
                    <span className="badge" style={{ width: "fit-content", marginTop: 4 }}>
                      Override active ({formatCurrency(field.overrideValue)})
                            </span>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            maxWidth: 360,
                            width: "100%",
                          }}
                        >
                          <label style={{ display: "grid", gap: 4, fontSize: 13, fontWeight: 600 }}>
                            Override amount
                            <input
                              type="number"
                              step="0.01"
                              value={controlForm[field.key]}
                              onChange={(event) => handleControlChange(field.key, event.target.value)}
                              placeholder="Leave blank to use system value"
                            />
                          </label>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => applyOverride(field.key)}
                              disabled={manualControlsMutation.isPending}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => handleReset(field.key)}
                              disabled={manualControlsMutation.isPending}
                            >
                              Use system value
                            </button>
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
                            {lastUpdated
                              ? `Last updated ${lastUpdated}${updatedByLabel ? ` by ${updatedByLabel}` : ""}`
                              : "No manual override saved"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {(data.displayFlags?.displayCash ?? true) ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 24,
              }}
            >
              <CashTable title="Cash inflows" entries={data.cash.inflows} total={data.cash.inflowTotal} />
              <CashTable title="Cash outflows" entries={data.cash.outflows} total={data.cash.outflowTotal} />
            </div>
          ) : null}

          {(data.displayFlags?.displayReceivables ?? true) || (data.displayFlags?.displayPayables ?? true) ? (
            <DebtCreditTables
              customerDebts={(data.displayFlags?.displayReceivables ?? true) ? customerDebtRows : []}
              payableDebts={(data.displayFlags?.displayPayables ?? true) ? payableDebtRows : []}
            />
          ) : null}

          {customerIdFilter ? (
            <ReceiptDetailTable entries={data.details?.customerReceipts ?? []} />
          ) : null}

          {supplierIdFilter ? (
            <PurchaseDetailTable entries={data.details?.supplierPurchases ?? []} />
          ) : null}

          {(data.displayFlags?.displayPayables ?? true) ? (
            <>
              <PurchasePayablesTable entries={data.payables.purchases} />
              <LaborPayablesTable entries={data.payables.labor} />

              <div className="section-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ marginTop: 0 }}>Payroll pending</h3>
                  <Link className="ghost-button" to="/payroll">
                    Open payroll
                  </Link>
                </div>
                {data.payables.payroll.length === 0 ? (
                  <p style={{ margin: 0 }}>No unpaid payroll entries.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Period</th>
                          <th>Product</th>
                          <th style={{ textAlign: "right" }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.payables.payroll.map((entry) => (
                          <tr key={entry.id}>
                            <td>{entry.employee}</td>
                            <td>
                              {formatDate(entry.periodStart)} → {formatDate(entry.periodEnd)}
                            </td>
                            <td>{entry.product ?? "—"}</td>
                            <td style={{ textAlign: "right" }}>{formatCurrency(entry.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default FinancePage;
