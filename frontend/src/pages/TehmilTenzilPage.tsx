import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchReceiptFlagSummary,
  settleTehmilPayment,
  settleTenzilPayment,
  recordFlagBulkPayment,
  type FlaggedReceiptSummary,
} from "../api/receipts";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

type PaymentTarget = {
  type: "TEHMIL" | "TENZIL";
  receipt: FlaggedReceiptSummary;
};

type PaymentFormState = {
  amount: string;
  quantity: string;
  date: string;
  note: string;
};

const initialPaymentForm = (): PaymentFormState => ({
  amount: "",
  quantity: "",
  date: new Date().toISOString().slice(0, 10),
  note: "",
});

const filterByRange = (
  receipts: FlaggedReceiptSummary[],
  startDate: string,
  endDate: string,
): FlaggedReceiptSummary[] => {
  if (!startDate && !endDate) {
    return receipts;
  }
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if ((startDate && (!start || Number.isNaN(start.getTime()))) || (endDate && (!end || Number.isNaN(end.getTime())))) {
    return receipts;
  }
  return receipts.filter((receipt) => {
    const receiptDate = new Date(receipt.date);
    if (Number.isNaN(receiptDate.getTime())) {
      return false;
    }
    if (start && receiptDate < start) return false;
    if (end) {
      const adjusted = new Date(end);
      adjusted.setHours(23, 59, 59, 999);
      if (receiptDate > adjusted) return false;
    }
    return true;
  });
};

export default function TehmilTenzilPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tehmil-tenzil"],
    queryFn: () => fetchReceiptFlagSummary(500),
  });

  const [activePayment, setActivePayment] = useState<PaymentTarget | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(initialPaymentForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [bulkTehmilForm, setBulkTehmilForm] = useState({
    startDate: "",
    endDate: "",
    amount: "",
    date: today,
    note: "",
  });
  const [bulkTenzilForm, setBulkTenzilForm] = useState({
    startDate: "",
    endDate: "",
    amount: "",
    date: today,
    note: "",
  });

  const handleStartPayment = (type: PaymentTarget["type"], receipt: FlaggedReceiptSummary) => {
    setActivePayment({ type, receipt });
    setPaymentForm(initialPaymentForm());
    setFormError(null);
  };

  const clearPaymentState = () => {
    setActivePayment(null);
    setPaymentForm(initialPaymentForm());
    setFormError(null);
  };

  const refreshSummary = () => {
    queryClient.invalidateQueries({ queryKey: ["tehmil-tenzil"] });
  };

  const tehmilMutation = useMutation({
    mutationFn: ({ id, amount, date, note }: { id: number; amount: number; date: string; note: string }) =>
      settleTehmilPayment(id, { amount, date, note }),
    onSuccess: () => {
      refreshSummary();
      clearPaymentState();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to record Tehmil payment");
    },
  });

  const tenzilMutation = useMutation({
    mutationFn: ({ id, amount, date, note }: { id: number; amount: number; date: string; note: string }) =>
      settleTenzilPayment(id, { amount, date, note }),
    onSuccess: () => {
      refreshSummary();
      clearPaymentState();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to record Tenzil payment");
    },
  });

  const submitting = tehmilMutation.isPending || tenzilMutation.isPending;
  const bulkMutation = useMutation({
    mutationFn: recordFlagBulkPayment,
    onSuccess: () => {
      refreshSummary();
      setBulkTehmilForm((prev) => ({ ...prev, amount: "" }));
      setBulkTenzilForm((prev) => ({ ...prev, amount: "" }));
      setGlobalError(null);
    },
    onError: (err: any) => {
      setGlobalError(err?.response?.data?.error ?? err?.message ?? "Failed to record bulk payment");
    },
  });

  const summary = data?.summary ?? {
    tehmilDueCount: 0,
    tehmilDueTotal: 0,
    tenzilDueCount: 0,
    tenzilDueTotal: 0,
  };

  const tehmilDue = data?.tehmilDue ?? [];
  const tenzilDue = data?.tenzilDue ?? [];

  const handleSubmitPayment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePayment) return;
    setFormError(null);

    if (paymentForm.amount.trim().length === 0) {
      setFormError("Enter an amount to record this payment.");
      return;
    }
    const parsedAmount = Number(paymentForm.amount);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      setFormError("Enter a valid number for the amount.");
      return;
    }
    let parsedQuantity: number | null = null;
    if (paymentForm.quantity.trim().length > 0) {
      const q = Number(paymentForm.quantity);
      if (Number.isNaN(q) || q < 0) {
        setFormError("Enter a valid number for the quantity.");
        return;
      }
      parsedQuantity = q;
    }

    const payload = {
      id: activePayment.receipt.id,
      amount: parsedAmount,
      date: paymentForm.date,
      note: paymentForm.note.trim(),
      quantity: parsedQuantity ?? undefined,
    };
    if (activePayment.type === "TEHMIL") {
      tehmilMutation.mutate(payload);
    } else {
      tenzilMutation.mutate(payload);
    }
  };

  const tehmilFiltered = useMemo(
    () => filterByRange(tehmilDue, bulkTehmilForm.startDate, bulkTehmilForm.endDate),
    [tehmilDue, bulkTehmilForm.startDate, bulkTehmilForm.endDate],
  );
  const tenzilFiltered = useMemo(
    () => filterByRange(tenzilDue, bulkTenzilForm.startDate, bulkTenzilForm.endDate),
    [tenzilDue, bulkTenzilForm.startDate, bulkTenzilForm.endDate],
  );

  const handleBulkInputChange = (
    type: "TEHMIL" | "TENZIL",
    field: "startDate" | "endDate" | "amount" | "date" | "note",
    value: string,
  ) => {
    if (type === "TEHMIL") {
      setBulkTehmilForm((prev) => ({ ...prev, [field]: value }));
    } else {
      setBulkTenzilForm((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleBulkSubmit = (
    event: React.FormEvent<HTMLFormElement>,
    type: "TEHMIL" | "TENZIL",
    formState: typeof bulkTehmilForm,
    filteredReceipts: FlaggedReceiptSummary[],
  ) => {
    event.preventDefault();
    setGlobalError(null);

    if (!formState.startDate || !formState.endDate) {
      setGlobalError("Select a start and end date for the bulk payment.");
      return;
    }
    if (filteredReceipts.length === 0) {
      setGlobalError("No flagged receipts match the selected date range.");
      return;
    }
    const trimmedAmount = formState.amount.trim();
    if (trimmedAmount.length === 0) {
      setGlobalError("Enter an amount to record the bulk payment.");
      return;
    }
    const parsedAmount = Number(trimmedAmount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setGlobalError("Enter a valid number for the amount.");
      return;
    }
    bulkMutation.mutate({
      type,
      startDate: formState.startDate,
      endDate: formState.endDate,
      amount: parsedAmount,
      date: formState.date,
      note: formState.note.trim() || undefined,
    });
  };

  const renderBulkForm = (
    label: string,
    type: "TEHMIL" | "TENZIL",
    formState: typeof bulkTehmilForm,
    filteredReceipts: FlaggedReceiptSummary[],
  ) => (
    <div className="section-card">
      <h3 style={{ marginTop: 0 }}>{label} bulk payment</h3>
      <form
        className="form-grid two-columns"
        onSubmit={(event) => handleBulkSubmit(event, type, formState, filteredReceipts)}
      >
        <label>
          Start date *
          <input
            type="date"
            value={formState.startDate}
            onChange={(event) => handleBulkInputChange(type, "startDate", event.target.value)}
          />
        </label>
        <label>
          End date *
          <input
            type="date"
            value={formState.endDate}
            onChange={(event) => handleBulkInputChange(type, "endDate", event.target.value)}
          />
        </label>
        <label>
          Amount *
          <input
            type="number"
            step="any"
            value={formState.amount}
            onChange={(event) => handleBulkInputChange(type, "amount", event.target.value)}
          />
        </label>
        <label>
          Payment date
          <input
            type="date"
            value={formState.date}
            onChange={(event) => handleBulkInputChange(type, "date", event.target.value)}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Note
          <textarea
            value={formState.note}
            onChange={(event) => handleBulkInputChange(type, "note", event.target.value)}
            placeholder="Optional note"
          />
        </label>
        <p style={{ gridColumn: "1 / -1", color: "var(--color-muted)" }}>
          Matching receipts: {filteredReceipts.length}
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="submit"
            className="primary-button"
            disabled={bulkMutation.isPending}
          >
            {bulkMutation.isPending ? "Saving…" : "Save bulk payment"}
          </button>
        </div>
      </form>
    </div>
  );

  const renderTable = (
    label: string,
    receipts: FlaggedReceiptSummary[],
    type: PaymentTarget["type"],
  ) => (
    <div className="section-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ marginTop: 0 }}>{label}</h3>
        <span style={{ color: "var(--color-muted)" }}>
          {receipts.length} due
        </span>
      </div>
      {receipts.length === 0 ? (
        <p style={{ marginBottom: 0 }}>All caught up.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Outstanding</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => (
                <tr key={`${type}-${receipt.id}`}>
                  <td>{new Date(receipt.date).toLocaleDateString()}</td>
                  <td>{receipt.receiptNo ?? `#${receipt.id}`}</td>
                  <td>{receipt.customer?.name ?? receipt.walkInName ?? "Walk-in"}</td>
                  <td>{formatCurrency(0)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => handleStartPayment(type, receipt)}
                      >
                        Record payment
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const totalDue = { tehmil: 0, tenzil: 0 };

  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <section>
      <header>
        <h2>Tehmil & Tenzil tracker</h2>
        <p>Monitor outstanding Tehmil and Tenzil receipts and close them out when payments are made.</p>
      </header>

      <div className="section-card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "10px 14px",
              minWidth: 160,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <strong>{summary.tehmilDueCount}</strong>
            <span>Tehmil due</span>
            <small>{formatCurrency(totalDue.tehmil)}</small>
          </div>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "10px 14px",
              minWidth: 160,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <strong>{summary.tenzilDueCount}</strong>
            <span>Tenzil due</span>
            <small>{formatCurrency(totalDue.tenzil)}</small>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <p className="error-text">{errorMessage}</p>
      ) : isLoading ? (
        <p>Loading tracker…</p>
      ) : (
        <>
          {renderBulkForm("Tehmil", "TEHMIL", bulkTehmilForm, tehmilFiltered)}
          {renderTable("Tehmil", tehmilFiltered, "TEHMIL")}
          {renderBulkForm("Tenzil", "TENZIL", bulkTenzilForm, tenzilFiltered)}
          {renderTable("Tenzil", tenzilFiltered, "TENZIL")}
        </>
      )}

      {globalError ? (
        <p className="error-text" style={{ marginTop: 12 }}>
          {globalError}
        </p>
      ) : null}

      {activePayment ? (
        <div className="section-card" style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>
            Record {activePayment.type === "TEHMIL" ? "Tehmil" : "Tenzil"} payment for receipt{" "}
            {activePayment.receipt.receiptNo ?? `#${activePayment.receipt.id}`}
          </h3>
          <form className="form-grid two-columns" onSubmit={handleSubmitPayment}>
            <label>
              Amount *
              <input
                type="number"
                step="any"
                value={paymentForm.amount}
                onChange={(event) =>
                  setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                step="any"
                value={paymentForm.quantity}
                onChange={(event) =>
                  setPaymentForm((prev) => ({ ...prev, quantity: event.target.value }))
                }
                placeholder="e.g. 120"
              />
            </label>
            <label>
              Payment date
              <input
                type="date"
                value={paymentForm.date}
                onChange={(event) =>
                  setPaymentForm((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Note
              <textarea
                value={paymentForm.note}
                onChange={(event) =>
                  setPaymentForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder="Optional note"
              />
            </label>
            {formError ? (
              <p className="error-text" style={{ gridColumn: "1 / -1" }}>
                {formError}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 12 }}>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? "Saving…" : "Save payment"}
              </button>
              <button type="button" className="secondary-button" onClick={clearPaymentState}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
