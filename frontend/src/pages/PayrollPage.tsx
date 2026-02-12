import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { fetchEmployees } from "../api/employees";
import {
  createPayrollEntry,
  createPayrollRun,
  debitPayrollRun,
  fetchPayrollPage,
  fetchPayrollRuns,
  finalizePayrollRun,
} from "../api/payroll";
import { fetchProductionLaborWeeklySummary } from "../api/inventory";
import { fetchTehmilTenzilWeeklySummary } from "../api/receipts";
import { fetchProducts } from "../api/products";
import type {
  Employee,
  PayrollEntry,
  PayrollRun,
  PayrollType,
  Product,
  ProductionLaborWeeklySummary,
  TehmilTenzilWeeklySummary,
} from "../types";

type PayrollPageResult = Awaited<ReturnType<typeof fetchPayrollPage>>;

const todayIso = () => new Date().toISOString().slice(0, 10);

type FormState = {
  employeeId: string;
  type: PayrollType;
  quantity: string;
  amount: string;
  notes: string;
  createPayment: boolean;
  paymentDate: string;
  paymentReference: string;
  stoneProductId: string;
  helperEmployeeId: string;
  rememberHelper: boolean;
};

const getStoredHelperPrefs = () => {
  if (typeof window === "undefined") {
    return { helperEmployeeId: "", rememberHelper: true };
  }
  const storedHelper = window.localStorage.getItem("helperEmployeeId") ?? "";
  const storedRemember = window.localStorage.getItem("helperRemember");
  return {
    helperEmployeeId: storedHelper,
    rememberHelper: storedRemember === null ? true : storedRemember !== "false",
  };
};

const createDefaultFormState = (): FormState => {
  const prefs = getStoredHelperPrefs();
  return {
    employeeId: "",
    type: "SALARY",
    quantity: "",
    amount: "",
    notes: "",
    createPayment: true,
    paymentDate: todayIso(),
    paymentReference: "",
    stoneProductId: "",
    helperEmployeeId: prefs.helperEmployeeId,
    rememberHelper: prefs.rememberHelper,
  };
};

const defaultRunRange = (frequency: "WEEKLY" | "MONTHLY") => {
  const end = new Date();
  const start =
    frequency === "WEEKLY"
      ? new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
      : new Date(end.getFullYear(), end.getMonth(), 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

function getEmployeeDisplay(employee: Employee): string {
  if (employee.payType === "SALARY" && employee.salaryAmount) {
    const per = employee.salaryFrequency === "MONTHLY" ? "month" : "week";
    return `${employee.name} – $${employee.salaryAmount.toFixed(2)} / ${per}`;
  }
  return employee.name;
}

export function PayrollPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<FormState>(() => createDefaultFormState());
  const [formError, setFormError] = useState<string | null>(null);
  const [amountManuallyEdited, setAmountManuallyEdited] = useState(false);
  const [runFrequency, setRunFrequency] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [runPeriodStart, setRunPeriodStart] = useState(defaultRunRange("WEEKLY").start);
  const [runPeriodEnd, setRunPeriodEnd] = useState(defaultRunRange("WEEKLY").end);
  const [runDebitAt, setRunDebitAt] = useState("");
  const [runNotes, setRunNotes] = useState("");
  const [runAutoGenerate, setRunAutoGenerate] = useState(true);
  const [weeklyStart, setWeeklyStart] = useState(defaultRunRange("WEEKLY").start);
  const [weeklyEnd, setWeeklyEnd] = useState(defaultRunRange("WEEKLY").end);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
  });

  const weeklySummaryQuery = useQuery<ProductionLaborWeeklySummary>({
    queryKey: ["weekly-manufacturing-payroll", weeklyStart, weeklyEnd],
    queryFn: () => fetchProductionLaborWeeklySummary({ start: weeklyStart, end: weeklyEnd }),
  });

  const tehmilSummaryQuery = useQuery<TehmilTenzilWeeklySummary>({
    queryKey: ["weekly-tehmil-tenzil", weeklyStart, weeklyEnd],
    queryFn: () => fetchTehmilTenzilWeeklySummary({ start: weeklyStart, end: weeklyEnd }),
  });

  const payrollQuery = useInfiniteQuery<
    PayrollPageResult,
    Error,
    InfiniteData<PayrollPageResult, number | undefined>,
    readonly ["payroll", "paginated"],
    number | undefined
  >({
    queryKey: ["payroll", "paginated"] as const,
    queryFn: ({ pageParam }) => fetchPayrollPage({ cursor: pageParam, limit: 50 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });

  const payrollEntries = useMemo<PayrollEntry[]>(
    () => payrollQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [payrollQuery.data],
  );

  const { data: payrollRuns = [], refetch: refetchRuns } = useQuery<PayrollRun[]>({
    queryKey: ["payroll-runs"],
    queryFn: () => fetchPayrollRuns(),
  });

  const isPayrollLoading = payrollQuery.status === "pending";
  const hasMorePayroll = Boolean(payrollQuery.hasNextPage);
  const isFetchingMorePayroll = payrollQuery.isFetchingNextPage;

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const createMutation = useMutation({
    mutationFn: createPayrollEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create payroll entry");
    },
  });

  const isSaving = createMutation.isPending;
  const runCreateMutation = useMutation({
    mutationFn: createPayrollRun,
    onSuccess: () => {
      refetchRuns();
      queryClient.invalidateQueries({ queryKey: ["payroll", "paginated"] });
    },
  });

  const finalizeRunMutation = useMutation({
    mutationFn: ({ id, debitAt, notes }: { id: number; debitAt?: string; notes?: string }) =>
      finalizePayrollRun(id, { debitAt, notes }),
    onSuccess: () => {
      refetchRuns();
    },
  });

  const debitRunMutation = useMutation({
    mutationFn: (id: number) => debitPayrollRun(id),
    onSuccess: () => {
      refetchRuns();
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
  });

  const selectedEmployee = useMemo(() => {
    const id = Number(formState.employeeId);
    if (!formState.employeeId || Number.isNaN(id)) return undefined;
    return employees.find((emp) => emp.id === id);
  }, [employees, formState.employeeId]);

  const pieceworkProducts = useMemo<Product[]>(
    () => products.filter((product) => product.isManufactured && (product.pieceworkRate ?? 0) > 0),
    [products],
  );

  const selectedStoneProduct = useMemo<Product | undefined>(() => {
    const id = Number(formState.stoneProductId);
    if (!formState.stoneProductId || Number.isNaN(id)) return undefined;
    return pieceworkProducts.find((product) => product.id === id);
  }, [pieceworkProducts, formState.stoneProductId]);

  const helperOptions = useMemo(() => {
    return employees.filter((employee) => employee.id !== Number(formState.employeeId));
  }, [employees, formState.employeeId]);

  const payrollType: PayrollType = selectedEmployee?.payType ?? formState.type;

  useEffect(() => {
    const range = defaultRunRange(runFrequency);
    setRunPeriodStart(range.start);
    setRunPeriodEnd(range.end);
  }, [runFrequency]);

  useEffect(() => {
    if (payrollType !== "PIECEWORK") {
      if (!amountManuallyEdited && formState.amount !== "") {
        setFormState((prev) => ({ ...prev, amount: "" }));
      }
      return;
    }

    const quantityNumber = Number(formState.quantity);
    const rate = selectedStoneProduct?.pieceworkRate;
    if (!rate || Number.isNaN(quantityNumber) || quantityNumber <= 0) {
      if (!amountManuallyEdited && formState.amount !== "") {
        setFormState((prev) => ({ ...prev, amount: "" }));
      }
      return;
    }

    if (amountManuallyEdited) {
      return;
    }

    const computedAmount = (quantityNumber * rate).toFixed(2);
    if (formState.amount !== computedAmount) {
      setFormState((prev) => ({ ...prev, amount: computedAmount }));
    }
  }, [payrollType, formState.quantity, selectedStoneProduct, amountManuallyEdited, formState.amount]);

  useEffect(() => {
    if (payrollType !== "PIECEWORK") {
      return;
    }
    if (pieceworkProducts.length === 1 && !formState.stoneProductId) {
      setFormState((prev) => ({ ...prev, stoneProductId: String(pieceworkProducts[0].id) }));
      setAmountManuallyEdited(false);
    }
  }, [payrollType, pieceworkProducts, formState.stoneProductId]);

  function resetForm() {
    setFormState(createDefaultFormState());
    setFormError(null);
    setAmountManuallyEdited(false);
  }

  function handleEmployeeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    const employee = employees.find((emp) => emp.id === Number(value));
    setFormState((prev) => ({
      ...prev,
      employeeId: value,
      type: (employee?.payType ?? prev.type) as PayrollType,
      helperEmployeeId:
        prev.helperEmployeeId && prev.helperEmployeeId === value ? "" : prev.helperEmployeeId,
    }));
    setAmountManuallyEdited(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!formState.employeeId) {
      setFormError("Select an employee");
      return;
    }

    if (payrollType === "PIECEWORK" && !formState.stoneProductId) {
      setFormError("Select the manufactured product for this piecework payroll entry");
      return;
    }

    if (payrollType === "PIECEWORK" && formState.stoneProductId) {
      const product = selectedStoneProduct;
      if (!product || !product.pieceworkRate || product.pieceworkRate <= 0) {
        setFormError("Set a piecework rate for the selected stone product");
        return;
      }
    }

    const amountNumber = formState.amount.trim().length > 0 ? Number(formState.amount) : undefined;
    if (amountNumber !== undefined && (Number.isNaN(amountNumber) || amountNumber <= 0)) {
      setFormError("Enter a valid override amount");
      return;
    }

    const payload: Parameters<typeof createPayrollEntry>[0] = {
      employeeId: Number(formState.employeeId),
      type: payrollType,
      quantity:
        payrollType === "PIECEWORK" && formState.quantity
          ? Number(formState.quantity)
          : undefined,
      amount: amountNumber,
      notes: formState.notes.trim() || undefined,
      createPayment: formState.createPayment,
      paymentDate: formState.createPayment ? formState.paymentDate || todayIso() : undefined,
      paymentReference: formState.paymentReference.trim() || undefined,
    };

    if (payrollType === "PIECEWORK" && formState.stoneProductId) {
      payload.stoneProductId = Number(formState.stoneProductId);
    }

    if (payrollType === "PIECEWORK" && formState.helperEmployeeId) {
      const helper = employees.find((emp) => emp.id === Number(formState.helperEmployeeId));
      if (!helper) {
        setFormError("Selected helper could not be found");
        return;
      }
      if (helper.id === Number(formState.employeeId)) {
        setFormError("Helper cannot be the same as the worker being paid");
        return;
      }
      payload.helperEmployeeId = helper.id;
    }

    if (payrollType === "PIECEWORK" && (!formState.quantity || Number(formState.quantity) <= 0)) {
      setFormError("Enter the quantity produced for piecework payments");
      return;
    }

    if (payrollType === "PIECEWORK" && formState.helperEmployeeId && !formState.stoneProductId) {
      setFormError("Select a stone product before logging the helper payout");
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem("helperRemember", formState.rememberHelper ? "true" : "false");
      if (formState.rememberHelper && formState.helperEmployeeId) {
        window.localStorage.setItem("helperEmployeeId", formState.helperEmployeeId);
      } else if (!formState.rememberHelper) {
        window.localStorage.removeItem("helperEmployeeId");
      }
    }

    createMutation.mutate(payload);
  }

  return (
    <section>
      <header>
        <h2>Payroll</h2>
        <p>Record salaries and piecework payouts for your team.</p>
      </header>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Weekly manufacturing payroll</h3>
        <p style={{ color: "var(--color-muted)", marginTop: -4 }}>
          See unpaid manufacturing labor for the selected week (piecework per 100).
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
            Week start
            <input type="date" value={weeklyStart} onChange={(e) => setWeeklyStart(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
            Week end
            <input type="date" value={weeklyEnd} onChange={(e) => setWeeklyEnd(e.target.value)} />
          </label>
        </div>
        {weeklySummaryQuery.isLoading ? (
          <p>Loading weekly totals…</p>
        ) : weeklySummaryQuery.error ? (
          <p className="error-text">Failed to load weekly payroll.</p>
        ) : (
          <>
            <div style={{ color: "var(--color-muted)", marginBottom: 8 }}>
              Range: {new Date(weeklySummaryQuery.data?.start ?? weeklyStart).toLocaleDateString()} →{" "}
              {new Date(weeklySummaryQuery.data?.end ?? weeklyEnd).toLocaleDateString()}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Owed</th>
                    <th>Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklySummaryQuery.data?.workers?.length ? (
                    weeklySummaryQuery.data.workers.map((worker) => (
                      <tr key={`${worker.id ?? "unknown"}-${worker.name}`}>
                        <td>{worker.name}</td>
                        <td>${worker.amount.toFixed(2)}</td>
                        <td>{worker.entries.length}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} style={{ color: "var(--color-muted)", textAlign: "center" }}>
                        No unpaid runs in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Weekly Tehmil/Tenzil</h3>
        <p style={{ color: "var(--color-muted)", marginTop: -4 }}>
          Owed Tehmil/Tenzil fees (same fee applied for both) for flagged receipts in this week.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
            Week start
            <input type="date" value={weeklyStart} onChange={(e) => setWeeklyStart(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: 12, color: "var(--color-muted)" }}>
            Week end
            <input type="date" value={weeklyEnd} onChange={(e) => setWeeklyEnd(e.target.value)} />
          </label>
        </div>
        {tehmilSummaryQuery.isLoading ? (
          <p>Loading Tehmil/Tenzil totals…</p>
        ) : tehmilSummaryQuery.error ? (
          <p className="error-text">Failed to load Tehmil/Tenzil summary.</p>
        ) : (
          <>
            <div style={{ color: "var(--color-muted)", marginBottom: 8 }}>
              Range: {new Date(tehmilSummaryQuery.data?.start ?? weeklyStart).toLocaleDateString()} →{" "}
              {new Date(tehmilSummaryQuery.data?.end ?? weeklyEnd).toLocaleDateString()} •{" "}
              Total: ${tehmilSummaryQuery.data?.total.toFixed(2) ?? "0.00"}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Tehmil</th>
                    <th>Tenzil</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tehmilSummaryQuery.data?.receipts?.length ? (
                    tehmilSummaryQuery.data.receipts.map((r) => (
                      <tr key={r.id}>
                        <td>{r.receiptNo}</td>
                        <td>{new Date(r.date).toLocaleDateString()}</td>
                        <td>{r.customer}</td>
                        <td>${r.tehmilTotal.toFixed(2)}</td>
                        <td>${r.tenzilTotal.toFixed(2)}</td>
                        <td>${r.total.toFixed(2)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--color-muted)" }}>
                        No unpaid Tehmil/Tenzil in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Build payroll run</h3>
        <p style={{ color: "var(--color-muted)" }}>
          Bundle unassigned payroll entries for the selected period, finalize, and debit automatically.
        </p>
        <div className="form-grid two-columns" style={{ marginBottom: 12 }}>
          <label>
            Frequency
            <select
              value={runFrequency}
              onChange={(event) => setRunFrequency(event.target.value as "WEEKLY" | "MONTHLY")}
            >
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          <label>
            Debit at (optional)
            <input type="date" value={runDebitAt} onChange={(e) => setRunDebitAt(e.target.value)} />
          </label>
          <label>
            Period start
            <input
              type="date"
              value={runPeriodStart}
              onChange={(e) => setRunPeriodStart(e.target.value)}
              required
            />
          </label>
          <label>
            Period end
            <input type="date" value={runPeriodEnd} onChange={(e) => setRunPeriodEnd(e.target.value)} required />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes (optional)
            <input value={runNotes} onChange={(e) => setRunNotes(e.target.value)} placeholder="Add a note" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1 / -1" }}>
            <input
              type="checkbox"
              checked={runAutoGenerate}
              onChange={(e) => setRunAutoGenerate(e.target.checked)}
            />
            Auto-generate entries for this period (weekly: drivers & manufacturing piecework; monthly: salaried staff)
          </label>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            runCreateMutation.mutate({
              frequency: runFrequency,
              periodStart: runPeriodStart,
              periodEnd: runPeriodEnd,
              debitAt: runDebitAt || undefined,
              notes: runNotes || undefined,
              autoGenerate: runAutoGenerate,
            })
          }
          disabled={runCreateMutation.isPending}
        >
          {runCreateMutation.isPending ? "Building…" : "Build payroll run"}
        </button>
        {runCreateMutation.error ? (
          <p className="error-text" style={{ marginTop: 8 }}>
            {(runCreateMutation.error as any)?.response?.data?.error ??
              (runCreateMutation.error as Error).message}
          </p>
        ) : null}
      </div>

      <div className="section-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Payroll runs</h3>
        {payrollRuns.length === 0 ? (
          <p style={{ color: "var(--color-muted)" }}>No runs yet. Build one above.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Debit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payrollRuns.map((run) => {
                  const periodLabel = `${new Date(run.periodStart).toLocaleDateString()} – ${new Date(
                    run.periodEnd,
                  ).toLocaleDateString()}`;
                  const isFinalized = run.status === "FINALIZED";
                  const isPaid = run.status === "PAID";
                  return (
                    <tr key={run.id}>
                      <td>{periodLabel}</td>
                      <td>{run.frequency}</td>
                      <td>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: isPaid ? "#ecfdf3" : isFinalized ? "#fef3c7" : "#eef2ff",
                            color: isPaid ? "#166534" : isFinalized ? "#92400e" : "#312e81",
                            fontSize: "0.8rem",
                          }}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>${run.totalNet.toFixed(2)}</td>
                      <td>
                        {run.paidAt
                          ? new Date(run.paidAt).toLocaleDateString()
                          : run.debitAt
                            ? new Date(run.debitAt).toLocaleDateString()
                            : "—"}
                      </td>
                      <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {run.status !== "PAID" ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              finalizeRunMutation.mutate({
                                id: run.id,
                                debitAt: run.debitAt ?? undefined,
                                notes: run.notes ?? undefined,
                              })
                            }
                            disabled={finalizeRunMutation.isPending}
                          >
                            {finalizeRunMutation.isPending ? "Finalizing…" : "Finalize"}
                          </button>
                        ) : null}
                        {run.status === "FINALIZED" || run.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => debitRunMutation.mutate(run.id)}
                            disabled={debitRunMutation.isPending}
                          >
                            {debitRunMutation.isPending ? "Debiting…" : "Debit now"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Log payroll entry</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Employee *
            <select value={formState.employeeId} onChange={handleEmployeeChange} required>
              <option value="" disabled>
                Select employee
              </option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplay(employee)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payroll type
            <input value={payrollType === "SALARY" ? "Salary" : "Piecework"} disabled />
          </label>
          {payrollType === "PIECEWORK" && (
            <>
              <label>
                Stone product{pieceworkProducts.length > 0 ? " *" : ""}
                <select
                  value={formState.stoneProductId}
                  disabled={pieceworkProducts.length === 0}
                  onChange={(event) => {
                    setFormState((prev) => ({ ...prev, stoneProductId: event.target.value }));
                    setAmountManuallyEdited(false);
                  }}
                >
                  <option value="">Select stone product</option>
                  {pieceworkProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} – ${product.pieceworkRate?.toFixed(2) ?? "0.00"} per unit
                    </option>
                  ))}
                </select>
                {pieceworkProducts.length === 0 ? (
                  <small style={{ color: "var(--color-muted)", marginTop: 4 }}>
                    Set piecework rates on stone products in the Products page.
                  </small>
                ) : selectedStoneProduct?.pieceworkRate ? (
                  <small style={{ color: "var(--color-muted)", marginTop: 4 }}>
                    Piece rate: ${selectedStoneProduct.pieceworkRate.toFixed(2)} per unit
                    {selectedStoneProduct.helperPieceworkRate
                      ? ` • Helper: $${selectedStoneProduct.helperPieceworkRate.toFixed(2)} per unit`
                      : ""}
                  </small>
                ) : null}
              </label>
              <label>
                Helper worker
                <select
                  value={formState.helperEmployeeId}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, helperEmployeeId: event.target.value }))
                  }
                  disabled={isSaving}
                >
                  <option value="">No helper (skip payout)</option>
                  {helperOptions.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
                <small style={{ color: "var(--color-muted)", marginTop: 4 }}>
                  Select the helper who receives the per-stone bonus.
                </small>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: -8 }}>
                <input
                  type="checkbox"
                  checked={formState.rememberHelper}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      rememberHelper: event.target.checked,
                    }))
                  }
                  disabled={isSaving}
                />
                <span style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
                  Remember helper for next time
                </span>
              </div>
              <label>
                Quantity produced *
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formState.quantity}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, quantity: event.target.value }))
                  }
                  placeholder="Number of units"
                />
              </label>
            </>
          )}

          <label>
            Override amount
            <input
              type="number"
              min="0"
              step="any"
              value={formState.amount}
              onChange={(event) => {
                const nextValue = event.target.value;
                setFormState((prev) => ({ ...prev, amount: nextValue }));
                setAmountManuallyEdited(nextValue.trim().length > 0);
              }}
              placeholder="Leave blank to auto-calculate"
            />
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Optional description"
            />
          </label>

          <label>
            Create payment record
            <input
              type="checkbox"
              checked={formState.createPayment}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  createPayment: event.target.checked,
                  paymentDate: event.target.checked
                    ? prev.paymentDate || todayIso()
                    : prev.paymentDate,
                }))
              }
              style={{ marginTop: 8 }}
            />
          </label>

          {formState.createPayment && (
            <>
              <label>
                Payment date
                <input
                  type="date"
                  value={formState.paymentDate}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, paymentDate: event.target.value }))
                  }
                />
              </label>
              <label>
                Payment reference
                <input
                  value={formState.paymentReference}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, paymentReference: event.target.value }))
                  }
                  placeholder="Cheque #, bank ref, etc."
                />
              </label>
            </>
          )}

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Save payroll entry"}
            </button>
            <button type="button" className="secondary-button" onClick={resetForm}>
              Reset
            </button>
          </div>
          {formError && (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Recent payroll</h3>
        {isPayrollLoading ? (
          <p>Loading payroll entries…</p>
        ) : payrollEntries.length === 0 ? (
          <p>No payroll entries yet.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Stone</th>
                    <th>Helper</th>
                    <th>Amount</th>
                    <th>Quantity</th>
                    <th>Payment</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollEntries.map((entry: PayrollEntry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.createdAt).toLocaleDateString()}</td>
                      <td>{entry.employee.name}</td>
                      <td>{entry.type === "SALARY" ? "Salary" : "Piecework"}</td>
                      <td>{entry.stoneProduct?.name ?? "—"}</td>
                      <td>{entry.helperEmployee?.name ?? "—"}</td>
                      <td>${entry.amount.toFixed(2)}</td>
                      <td>{entry.quantity ?? "—"}</td>
                      <td>
                        {entry.payment
                          ? `$${entry.payment.amount.toFixed(2)} on ${new Date(
                              entry.payment.date,
                            ).toLocaleDateString()}`
                          : "Not logged"}
                      </td>
                      <td>{entry.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMorePayroll && !isPayrollLoading ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => payrollQuery.fetchNextPage()}
                  disabled={isFetchingMorePayroll}
                >
                  {isFetchingMorePayroll ? "Loading more…" : "Load more entries"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export default PayrollPage;
