import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchDashboard } from "../api/dashboard";
import { createCashEntry } from "../api/cash";
import { createCashCustodyEntry, fetchCashCustody } from "../api/cashCustody";
import { useAuth } from "../context/AuthContext";

function formatCurrency(value?: number | null): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export function DashboardPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
  const [ownerDrawAmount, setOwnerDrawAmount] = useState("0");
  const [ownerDrawDescription, setOwnerDrawDescription] = useState("");
  const [ownerDrawError, setOwnerDrawError] = useState<string | null>(null);
  const [custodyForm, setCustodyForm] = useState<{
    amount: string;
    fromEmployeeId: string;
    toEmployeeId: string;
    description: string;
  }>({
    amount: "",
    fromEmployeeId: "",
    toEmployeeId: "",
    description: "",
  });
  const [custodyError, setCustodyError] = useState<string | null>(null);

  const ownerDrawMutation = useMutation({
    mutationFn: ({ amount, description }: { amount: number; description?: string }) =>
      createCashEntry({ amount, type: "OWNER_DRAW", description }),
    onSuccess: () => {
      setOwnerDrawAmount("0");
      setOwnerDrawDescription("");
      setOwnerDrawError(null);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err: any) => {
      setOwnerDrawError(err?.response?.data?.error ?? err?.message ?? "Failed to log owner draw");
    },
  });

  const allowedCustodyNames = useMemo(
    () => ["ahmad kadoura", "ahmad yasin", "bassam"],
    [],
  );
  const allowedCustodyNameSet = useMemo(
    () => new Set(allowedCustodyNames),
    [allowedCustodyNames],
  );

  const custodyQuery = useQuery({
    queryKey: ["cash", "custody"],
    queryFn: fetchCashCustody,
    enabled: can("cash:manage"),
  });

  const custodyData = custodyQuery.data;
  const custodyEmployees = custodyData?.employees ?? [];
  const custodyOutstandingAll = custodyData?.outstanding ?? [];
  const custodyEntriesAll = custodyData?.entries ?? [];
  const filteredCustodyOutstanding = useMemo(
    () =>
      custodyOutstandingAll.filter((record) =>
        allowedCustodyNameSet.has(record.employee.name?.trim().toLowerCase() ?? ""),
      ),
    [custodyOutstandingAll, allowedCustodyNameSet],
  );
  const filteredCustodyEntries = useMemo(
    () =>
      custodyEntriesAll.filter(
        (entry) =>
          allowedCustodyNameSet.has(entry.fromEmployee.name?.trim().toLowerCase() ?? "") ||
          allowedCustodyNameSet.has(entry.toEmployee.name?.trim().toLowerCase() ?? ""),
      ),
    [custodyEntriesAll, allowedCustodyNameSet],
  );
  const employeesLoading = custodyQuery.isLoading || custodyEmployees.length < 2;

  const custodyMutation = useMutation({
    mutationFn: createCashCustodyEntry,
    onSuccess: () => {
      setCustodyForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));
      setCustodyError(null);
      queryClient.invalidateQueries({ queryKey: ["cash", "custody"] });
    },
    onError: (err: any) => {
      setCustodyError(
        err?.response?.data?.error ?? err?.message ?? "Failed to record cash custody entry",
      );
    },
  });

  const pendingPayrollCount = useMemo(() => data?.payroll.pendingEntries.length ?? 0, [data]);

  useEffect(() => {
    if (!can("cash:manage") || custodyEmployees.length === 0) {
      return;
    }
    setCustodyForm((prev) => {
      if (prev.fromEmployeeId && prev.toEmployeeId) {
        const hasFrom = custodyEmployees.some(
          (employee) => String(employee.id) === prev.fromEmployeeId,
        );
        const hasTo = custodyEmployees.some(
          (employee) => String(employee.id) === prev.toEmployeeId,
        );
        if (hasFrom && hasTo) {
          return prev;
        }
      }
      const kadoura = custodyEmployees.find((emp) =>
        (emp.name ?? "").toLowerCase().includes("kadoura"),
      );
      const yasin = custodyEmployees.find((emp) =>
        (emp.name ?? "").toLowerCase().includes("yasin"),
      );
      const defaultFrom = kadoura ?? custodyEmployees[0];
      const defaultTo =
        yasin ?? custodyEmployees.find((emp) => emp.id !== defaultFrom.id) ?? defaultFrom;
      return {
        ...prev,
        fromEmployeeId: defaultFrom ? String(defaultFrom.id) : "",
        toEmployeeId:
          defaultTo && defaultTo.id !== defaultFrom.id ? String(defaultTo.id) : "",
      };
    });
  }, [can, custodyEmployees]);

  function handleCustodySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!can("cash:manage")) {
      return;
    }
    const amount = Number(custodyForm.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      setCustodyError("Enter a positive amount");
      return;
    }
    if (!custodyForm.fromEmployeeId || !custodyForm.toEmployeeId) {
      setCustodyError("Choose both employees");
      return;
    }
    if (custodyForm.fromEmployeeId === custodyForm.toEmployeeId) {
      setCustodyError("From and to employees must be different");
      return;
    }
    const fromEmployee = custodyEmployees.find(
      (employee) => String(employee.id) === custodyForm.fromEmployeeId,
    );
    const toEmployee = custodyEmployees.find(
      (employee) => String(employee.id) === custodyForm.toEmployeeId,
    );
    if (!fromEmployee || !toEmployee) {
      setCustodyError("Only Ahmad Kadoura, Ahmad Yasin, or Bassam can be selected");
      return;
    }
    setCustodyError(null);
    custodyMutation.mutate({
      amount,
      fromEmployeeId: fromEmployee.id,
      toEmployeeId: toEmployee.id,
      description: custodyForm.description.trim() || undefined,
    });
  }

  const isCustodySaving = custodyMutation.isPending;

  return (
    <section>
      <header>
        <h2>Dashboard</h2>
        <p>At-a-glance view of cash, operations, and priorities. Jump into any module below.</p>
      </header>

      {isLoading ? (
        <p>Loading dashboard…</p>
      ) : error ? (
        <p className="error-text">Failed to load dashboard summary.</p>
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 24 }}>
          <div className="stat-grid">
            <div className="stat-card">
              <h4>Cash on hand</h4>
              <strong>{formatCurrency(data.cash.onHand)}</strong>
              <span className="badge">
                Paid in {formatCurrency(data.cash.paidIn)} • Paid out {formatCurrency(data.cash.paidOut)}
              </span>
              <Link className="ghost-button" to="/finance" style={{ marginTop: 12 }}>
                View finance
              </Link>
            </div>
            <div className="stat-card">
              <h4>Receivables (credit)</h4>
              <strong>{formatCurrency(data.finance.receivables)}</strong>
              <span className="badge">{data.receipts.outstandingCount} invoices due</span>
            </div>
            <div className="stat-card">
              <h4>Payables (debit)</h4>
              <strong>{formatCurrency(data.finance.payables)}</strong>
              <span className="badge">
                Suppliers {formatCurrency(data.finance.purchasePayables)} • Labor{" "}
                {formatCurrency(data.finance.laborPayables)}
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <Link className="ghost-button" to="/reports">
                  Review suppliers
                </Link>
                {data.finance.laborPayables > 0 ? (
                  <Link className="ghost-button" to="/manufacturing">
                    Settle labor ({data.finance.outstandingLaborCount})
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="stat-card">
              <h4>Net credit - debit</h4>
              <strong>{formatCurrency(data.finance.receivables - data.finance.payables)}</strong>
              <span className="badge">Positive means customers owe more than we owe</span>
            </div>
            <div className="stat-card">
              <h4>Sales (today)</h4>
              <strong>{formatCurrency(data.receipts.todayTotal)}</strong>
              <span className="badge">
                Paid today {formatCurrency(data.receipts.todayPaid)} • Month{" "}
                {formatCurrency(data.receipts.monthTotal)}
              </span>
            </div>
          </div>
          <div className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <div>
                <h3 style={{ marginTop: 0 }}>Cash movements</h3>
                <p style={{ margin: 0, color: "var(--color-muted)" }}>
                  Quick snapshot of today’s inflow and outflow before drilling into Finance.
                </p>
              </div>
              <Link className="ghost-button" to="/finance">
                Open finance
              </Link>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
                marginTop: 16,
              }}
            >
              <div className="stat-card" style={{ margin: 0 }}>
                <h4 style={{ marginTop: 0 }}>Paid in</h4>
                <strong>{formatCurrency(data.cash.paidIn)}</strong>
                <span className="badge">Receipts + other inflows</span>
              </div>
              <div className="stat-card" style={{ margin: 0 }}>
                <h4 style={{ marginTop: 0 }}>Paid out</h4>
                <strong>{formatCurrency(data.cash.paidOut)}</strong>
                <span className="badge">Purchases, payroll, expenses</span>
              </div>
            </div>
          </div>
          <div className="stat-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h4>Expense outflow (month)</h4>
              <strong>{formatCurrency(data.expenses.monthTotal)}</strong>
            </div>
            <Link className="ghost-button" to="/payments">
              Record payment
            </Link>
          </div>

          <div className="form-grid two-columns">
            <div className="section-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <h3 style={{ marginTop: 0 }}>Receipts & Accounts Receivable</h3>
                  <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>
                    Keep cash flowing by clearing outstanding invoices regularly.
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>{data.receipts.outstandingCount}</strong> invoices outstanding totalling
                    <strong> {formatCurrency(data.receipts.outstandingAmount)}</strong>
                  </p>
                </div>
                <Link className="primary-button" to="/receipts">
                  Manage receipts
                </Link>
              </div>
            </div>

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
                  <h3 style={{ marginTop: 0 }}>Cash movements</h3>
                  <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>
                    Track deposits, withdrawals, and owner draws to understand real cash position.
                  </p>
                  <p style={{ margin: 0 }}>Cash paid out so far: {formatCurrency(data.cash.paidOut)}</p>
                </div>
                {can("cash:manage") ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const parsedAmount = Number(ownerDrawAmount);
                      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
                        setOwnerDrawError("Enter a positive amount");
                        return;
                      }
                      setOwnerDrawError(null);
                      ownerDrawMutation.mutate({
                        amount: parsedAmount,
                        description: ownerDrawDescription.trim() || undefined,
                      });
                    }}
                    style={{
                      display: "grid",
                      gap: 8,
                      minWidth: 240,
                      flex: "1 1 240px",
                      width: "100%",
                    }}
                  >
                    <label style={{ display: "grid", gap: 4 }}>
                      Owner draw amount
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={ownerDrawAmount}
                        onChange={(event) => setOwnerDrawAmount(event.target.value)}
                        required
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      Description
                      <input
                        type="text"
                        value={ownerDrawDescription}
                        onChange={(event) => setOwnerDrawDescription(event.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                    <button type="submit" className="secondary-button" disabled={ownerDrawMutation.isPending}>
                      {ownerDrawMutation.isPending ? "Logging…" : "Log owner draw"}
                    </button>
                    {ownerDrawError ? <p className="error-text">{ownerDrawError}</p> : null}
                  </form>
                ) : null}
              </div>
            </div>

            <div className="section-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <h3 style={{ marginTop: 0 }}>Debris operations</h3>
                  <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>
                    Monitor debris volume so crews know when to schedule haul-outs.
                  </p>
                  <p style={{ margin: 0 }}>
                {data.debris.removalsThisMonth.count} loads /{" "}
                {Number(data.debris.removalsThisMonth.volume ?? 0).toFixed(2)} m³ removed this month.
                  </p>
                </div>
                <Link className="secondary-button" to="/debris">
                  Manage debris
                </Link>
              </div>
            </div>

            <div className="section-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <h3 style={{ marginTop: 0 }}>Payroll readiness</h3>
                  {pendingPayrollCount === 0 ? (
                    <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>No unpaid payroll entries.</p>
                  ) : (
                    <ul style={{ paddingLeft: 16, marginTop: 0 }}>
                      {data.payroll.pendingEntries.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.employee.name}</strong> –{" "}
                          {formatCurrency(entry.amount)}
                          {entry.stoneProduct ? ` • ${entry.stoneProduct.name}` : ""} – recorded{" "}
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Link className="secondary-button" to="/payroll">
                  Review payroll
                </Link>
              </div>
            </div>
          </div>

          {can("cash:manage") ? (
            <div className="section-card">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <h3 style={{ margin: 0 }}>Cash custody (hand-offs)</h3>
                  <p style={{ margin: 0, color: "var(--color-muted)" }}>
                    Track cash that Ahmad Kadoura or other supervisors hand to field staff like
                    Ahmad Yasin without marking the money as spent.
                  </p>
                  {custodyQuery.isLoading ? (
                    <p style={{ margin: 0 }}>Loading custody summary…</p>
                  ) : filteredCustodyOutstanding.length === 0 ? (
                    <p style={{ margin: 0 }}>No cash is currently checked out to workers.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {filteredCustodyOutstanding.map((record) => (
                        <li key={record.employee.id}>
                          <strong>{record.employee.name}</strong> holds{" "}
                          {formatCurrency(record.amount)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <form
                  onSubmit={handleCustodySubmit}
                  className="form-grid two-columns"
                  style={{ marginTop: 8 }}
                >
                  <label>
                    Amount *
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={custodyForm.amount}
                      onChange={(event) =>
                        setCustodyForm((prev) => ({ ...prev, amount: event.target.value }))
                      }
                      required
                      disabled={isCustodySaving}
                    />
                  </label>
                  <label>
                    From *
                    <select
                      value={custodyForm.fromEmployeeId}
                      onChange={(event) =>
                        setCustodyForm((prev) => ({ ...prev, fromEmployeeId: event.target.value }))
                      }
                      disabled={employeesLoading || isCustodySaving}
                      required
                    >
                      <option value="" disabled>
                        Select employee
                      </option>
                      {custodyEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    To *
                    <select
                      value={custodyForm.toEmployeeId}
                      onChange={(event) =>
                        setCustodyForm((prev) => ({ ...prev, toEmployeeId: event.target.value }))
                      }
                      disabled={employeesLoading || isCustodySaving}
                      required
                    >
                      <option value="" disabled>
                        Select employee
                      </option>
                      {custodyEmployees
                        .filter((employee) => String(employee.id) !== custodyForm.fromEmployeeId)
                        .map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    Notes
                    <input
                      value={custodyForm.description}
                      onChange={(event) =>
                        setCustodyForm((prev) => ({ ...prev, description: event.target.value }))
                      }
                      placeholder="Optional memo"
                      disabled={isCustodySaving}
                    />
                  </label>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <button type="submit" className="primary-button" disabled={isCustodySaving}>
                      {isCustodySaving ? "Saving…" : "Save custody entry"}
                    </button>
                    {custodyError ? (
                      <p className="error-text" style={{ marginTop: 8 }}>
                        {custodyError}
                      </p>
                    ) : null}
                  </div>
                </form>

                <div>
                  <h4 style={{ marginBottom: 8 }}>Recent custody activity</h4>
                  {custodyQuery.isLoading ? (
                    <p style={{ margin: 0 }}>Loading entries…</p>
                  ) : filteredCustodyEntries.length === 0 ? (
                    <p style={{ margin: 0 }}>No custody entries logged yet.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>From</th>
                            <th>To</th>
                            <th>Amount</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCustodyEntries.slice(0, 8).map((entry) => (
                            <tr key={entry.id}>
                              <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                              <td>{entry.type === "HANDOFF" ? "Handoff" : "Return"}</td>
                              <td>{entry.fromEmployee.name}</td>
                              <td>{entry.toEmployee.name}</td>
                              <td>{formatCurrency(entry.amount)}</td>
                              <td>
                                {entry.description && entry.description.trim().length > 0
                                  ? entry.description
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="section-card">
            <h3 style={{ marginTop: 0 }}>Quick actions</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <Link className="secondary-button" to="/reports">
                📊 View advanced reports
              </Link>
              <Link className="secondary-button" to="/invoices">
                🧾 Build invoice
              </Link>
              <Link className="secondary-button" to="/inventory">
                📦 Update inventory entry
              </Link>
              <Link className="secondary-button" to="/suppliers">
                🤝 Review suppliers
              </Link>
              <Link className="secondary-button" to="/customers">
                👥 Manage customers
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default DashboardPage;
