import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchReceivablesHealth,
  fetchCashLedger,
  repairReceivables,
  repairReceiptById,
} from "../api/debug";
import { useAuth } from "../context/AuthContext";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export default function DebugPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["receivables-health"],
    queryFn: fetchReceivablesHealth,
  });
  const {
    data: ledger,
    isLoading: isLedgerLoading,
    refetch: refetchLedger,
  } = useQuery({
    queryKey: ["cash-ledger"],
    queryFn: () => fetchCashLedger({ allTime: true }),
  });

  const repairMutation = useMutation({
    mutationFn: repairReceivables,
    onSuccess: () => {
      refetch();
    },
  });

  const repairSingle = useMutation({
    mutationFn: (receiptId: number) => repairReceiptById(receiptId),
    onSuccess: () => {
      refetch();
    },
  });

  if (user?.role !== "ADMIN") {
    return <p className="error-text">Admins only.</p>;
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h2>Debug</h2>
        <p style={{ margin: 0, color: "var(--color-muted)" }}>
          Receivables health checks (read-only). Use this to find data issues causing wrong balances.
        </p>
      </header>

      <div className="section-card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="ghost-button" onClick={() => refetch()} disabled={isLoading || repairMutation.isPending}>
          {isLoading ? "Refreshing…" : "Refresh checks"}
        </button>
        <button
          className="secondary-button"
          onClick={() => repairMutation.mutate()}
          disabled={repairMutation.isPending}
        >
          {repairMutation.isPending ? "Fixing…" : "Fix mismatched receipts"}
        </button>
        {repairMutation.isSuccess ? (
          <span style={{ color: "green", fontWeight: 600 }}>
            Repaired {repairMutation.data?.count ?? 0} receipts.
          </span>
        ) : null}
          {repairMutation.isError ? (
            <span className="error-text">Failed to repair receipts.</span>
          ) : null}
      </div>

      <div className="section-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>Cash ledger (all time)</h3>
          <button className="ghost-button" onClick={() => refetchLedger()} disabled={isLedgerLoading}>
            {isLedgerLoading ? "Refreshing…" : "Refresh ledger"}
          </button>
        </div>
        {isLedgerLoading || !ledger ? (
          <p>Loading ledger…</p>
        ) : (
          <>
            <p style={{ margin: "4px 0", fontWeight: 600 }}>
              Inflows: {formatCurrency(ledger.inflowTotal)} | Outflows: {formatCurrency(ledger.outflowTotal)} | Cash on
              hand: {formatCurrency(ledger.cashOnHand)}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="table-scroll">
                <h4>Inflows by type</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ledger.inflowByType).map(([type, total]) => (
                      <tr key={type}>
                        <td>{type}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-scroll">
                <h4>Outflows by type</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ledger.outflowByType).map(([type, total]) => (
                      <tr key={type}>
                        <td>{type}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
              <div className="table-scroll">
                <h4>Inflows (latest 50)</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Label</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.inflows.slice(0, 50).map((i) => (
                      <tr key={i.id}>
                        <td>{new Date(i.date).toLocaleDateString()}</td>
                        <td>{i.type}</td>
                        <td>{i.label}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-scroll">
                <h4>Outflows (latest 50)</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Label</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.outflows.slice(0, 50).map((o) => (
                      <tr key={o.id}>
                        <td>{new Date(o.date).toLocaleDateString()}</td>
                        <td>{o.type}</td>
                        <td>{o.label}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(o.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {isLoading ? (
        <p>Loading…</p>
      ) : error ? (
        <p className="error-text">Failed to load debug info.</p>
      ) : data ? (
        <>
          <div className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Mismatched receipts</h3>
              <span className="badge">{data.mismatchedReceipts.length}</span>
            </div>
            {data.mismatchedReceipts.length === 0 ? (
              <p style={{ margin: 0 }}>No mismatches 🎉</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Stored paid</th>
                      <th>Linked paid</th>
                      <th>Delta</th>
                      <th>Stored paid?</th>
                      <th>Should be?</th>
                      <th>Fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mismatchedReceipts.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.customerId ?? "—"}</td>
                        <td>{formatCurrency(r.total)}</td>
                        <td>{formatCurrency(r.storedPaid)}</td>
                        <td>{formatCurrency(r.linkedPaid)}</td>
                        <td>{formatCurrency(r.delta)}</td>
                        <td>{r.storedIsPaid ? "Yes" : "No"}</td>
                        <td>{r.shouldBePaid ? "Yes" : "No"}</td>
                        <td>
                          <button
                            className="ghost-button"
                            onClick={() => repairSingle.mutate(r.id)}
                            disabled={repairSingle.isPending}
                          >
                            Fix
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Invalid payments</h3>
              <span className="badge">{data.invalidPayments.length}</span>
            </div>
            {data.invalidPayments.length === 0 ? (
              <p style={{ margin: 0 }}>No invalid payments.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Customer</th>
                      <th>Receipt</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invalidPayments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td>{p.type}</td>
                        <td>{p.customerId ?? "—"}</td>
                        <td>{p.receiptId ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Orphan receipt payments</h3>
              <span className="badge">{data.orphanReceiptPayments.length}</span>
            </div>
            {data.orphanReceiptPayments.length === 0 ? (
              <p style={{ margin: 0 }}>No orphan links.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Receipt</th>
                      <th>Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orphanReceiptPayments.map((o) => (
                      <tr key={o.id}>
                        <td>{o.id}</td>
                        <td>{o.receiptId ?? "—"}</td>
                        <td>{o.paymentId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ marginTop: 0 }}>Top outstanding customers</h3>
              <span className="badge">{data.topOutstanding.length}</span>
            </div>
            {data.topOutstanding.length === 0 ? (
              <p style={{ margin: 0 }}>No outstanding balances.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer ID</th>
                      <th style={{ textAlign: "right" }}>Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topOutstanding.map((o) => (
                      <tr key={o.customerId}>
                        <td>{o.customerId}</td>
                        <td style={{ textAlign: "right" }}>{formatCurrency(o.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
