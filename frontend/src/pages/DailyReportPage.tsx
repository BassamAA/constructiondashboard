import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { downloadDailyPdf, fetchDailyReport } from "../api/reports";
import type { DailyReport } from "../types";

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatMoney = (n: number) => `$${n.toFixed(2)}`;
const formatDateTime = (value: string | Date) => new Date(value).toLocaleString();

export default function DailyReportPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [downloading, setDownloading] = useState(false);
  const hasDate = date && !Number.isNaN(new Date(date).getTime());

  const dailyQuery = useQuery<DailyReport>({
    queryKey: ["daily-report", date],
    queryFn: () => fetchDailyReport({ date }),
    enabled: Boolean(hasDate),
  });

  const data = dailyQuery.data;
  const loading = dailyQuery.isLoading;
  const error = dailyQuery.error as Error | undefined;

  const summary = useMemo(() => {
    if (!data) return null;
    const receiptTotal = data.receipts.reduce((sum, r) => sum + Number(r.total ?? 0), 0);
    const inflowTypes = new Set(["RECEIPT", "CUSTOMER_PAYMENT"]);
    const paymentsIn = data.payments
      .filter((p) => inflowTypes.has(String(p.type)))
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const paymentsOut = data.payments
      .filter((p) => !inflowTypes.has(String(p.type)))
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const purchaseTotal = data.inventory.purchases.reduce((sum, p) => {
      const computed = p.totalCost ?? (p.unitCost ?? 0) * (p.quantity ?? 0);
      return sum + Number(computed ?? 0);
    }, 0);
    const productionCount = data.inventory.production.length;
    return { receiptTotal, paymentsIn, paymentsOut, purchaseTotal, productionCount };
  }, [data]);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2>Daily report</h2>
          <p>View everything that happened during a specific day.</p>
        </div>
      </header>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <div className="form-grid three-columns">
          <label>
            Date *
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayISO()}
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => dailyQuery.refetch()}
              disabled={!hasDate || dailyQuery.isFetching}
            >
              {dailyQuery.isFetching ? "Loading…" : "Load report"}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                if (!hasDate) return;
                try {
                  setDownloading(true);
                  const blob = await downloadDailyPdf({ date });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `daily-${date}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (err: any) {
                  alert(err?.message ?? "Failed to download daily report");
                } finally {
                  setDownloading(false);
                }
              }}
              disabled={!hasDate || downloading}
            >
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </div>
        {error ? <p className="error-text">{error.message ?? "Failed to load report"}</p> : null}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : !data ? (
        <p>Select a date to view the daily report.</p>
      ) : (
        <div className="section-card" style={{ display: "grid", gap: 16 }}>
          {summary ? (
            <div className="pill-row">
              <div className="pill">
                <strong>Receipts total</strong>
                <div>{formatMoney(summary.receiptTotal)}</div>
              </div>
              <div className="pill">
                <strong>Payments in</strong>
                <div>{formatMoney(summary.paymentsIn)}</div>
              </div>
              <div className="pill">
                <strong>Payments out</strong>
                <div>{formatMoney(summary.paymentsOut)}</div>
              </div>
              <div className="pill">
                <strong>Purchases</strong>
                <div>{formatMoney(summary.purchaseTotal)}</div>
              </div>
              <div className="pill">
                <strong>Production entries</strong>
                <div>{summary.productionCount}</div>
              </div>
            </div>
          ) : null}

          <Section title="Receipts" emptyText="No receipts" isEmpty={data.receipts.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Job site</th>
                  <th>Total</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.receiptNo ?? `#${r.id}`}</td>
                    <td>{formatDateTime(r.date)}</td>
                    <td>{r.customer?.name ?? r.walkInName ?? "Walk-in"}</td>
                    <td>{r.jobSite?.name ?? "—"}</td>
                    <td>{formatMoney(Number(r.total ?? 0))}</td>
                    <td>{formatMoney(Number(r.amountPaid ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Payments" emptyText="No payments" isEmpty={data.payments.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.date)}</td>
                    <td>{p.type}</td>
                    <td>{p.description ?? p.reference ?? p.customer?.name ?? p.supplier?.name ?? "—"}</td>
                    <td>{formatMoney(Number(p.amount ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="Inventory purchases"
            emptyText="No purchases"
            isEmpty={data.inventory.purchases.length === 0}
          >
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Total cost</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.inventory.purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.entryDate)}</td>
                    <td>{p.supplier?.name ?? "—"}</td>
                    <td>{p.product?.name ?? "—"}</td>
                    <td>{Number(p.quantity ?? 0).toLocaleString()}</td>
                    <td>{formatMoney(Number(p.totalCost ?? 0))}</td>
                    <td>{formatMoney(Number(p.amountPaid ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="Production entries"
            emptyText="No production"
            isEmpty={data.inventory.production.length === 0}
          >
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Labor paid?</th>
                </tr>
              </thead>
              <tbody>
                {data.inventory.production.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.entryDate)}</td>
                    <td>{p.product?.name ?? "—"}</td>
                    <td>{Number(p.quantity ?? 0).toLocaleString()}</td>
                    <td>{p.laborPaid ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Diesel logs" emptyText="No diesel logs" isEmpty={data.dieselLogs.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Truck</th>
                  <th>Driver</th>
                  <th>Liters</th>
                  <th>Total cost</th>
                </tr>
              </thead>
              <tbody>
                {data.dieselLogs.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDateTime(d.date)}</td>
                    <td>{d.truck?.plateNo ?? "—"}</td>
                    <td>{d.driver?.name ?? "—"}</td>
                    <td>{Number(d.liters ?? 0).toLocaleString()}</td>
                    <td>{formatMoney(Number(d.totalCost ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Debris" emptyText="No debris entries" isEmpty={data.debris.entries.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Volume</th>
                  <th>Removal cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.debris.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.date)}</td>
                    <td>{e.customer?.name ?? "—"}</td>
                    <td>{Number(e.volume ?? 0).toLocaleString()}</td>
                    <td>{formatMoney(Number(e.removalCost ?? 0))}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Payroll entries" emptyText="No payroll" isEmpty={data.payrollEntries.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Amount</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {data.payrollEntries.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td>{p.employee?.name ?? "—"}</td>
                    <td>{formatMoney(Number(p.amount ?? 0))}</td>
                    <td>{p.payment?.type ?? "UNPAID"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      )}
    </section>
  );
}

function Section({
  title,
  children,
  emptyText,
  isEmpty,
}: {
  title: string;
  children: React.ReactNode;
  emptyText: string;
  isEmpty?: boolean;
}) {
  return (
    <div className="section-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      {isEmpty ? <p style={{ margin: 0 }}>{emptyText}</p> : children}
    </div>
  );
}
