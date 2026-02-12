import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { fetchSuppliers } from "../api/suppliers";
import { fetchCustomers } from "../api/customers";
import { fetchReceipts } from "../api/receipts";
import { fetchPayrollPage } from "../api/payroll";
import {
  createPayment,
  deletePayment,
  fetchPayments,
  updatePayment,
} from "../api/payments";
import { fetchInventoryPayables, markInventoryEntryPaid } from "../api/inventory";
import { fetchDebris } from "../api/debris";
import type {
  Payment,
  PaymentType,
  Receipt,
  Supplier,
  PayrollEntry,
  DebrisEntry,
  Customer,
} from "../types";

type PayrollPageResult = Awaited<ReturnType<typeof fetchPayrollPage>>;

type FormState = {
  date: string;
  amount: string;
  type: PaymentType;
  description: string;
  category: string;
  reference: string;
  supplierId: string;
  customerId: string;
  receiptId: string;
  payrollEntryId: string;
  debrisEntryId: string;
  applyToReceipts: boolean;
};

const defaultForm: FormState = {
  date: "",
  amount: "",
  type: "GENERAL_EXPENSE",
  description: "",
  category: "",
  reference: "",
  supplierId: "",
  customerId: "",
  receiptId: "",
  payrollEntryId: "",
  debrisEntryId: "",
  applyToReceipts: true,
};

const paymentTypes: PaymentType[] = [
  "GENERAL_EXPENSE",
  "SUPPLIER",
  "RECEIPT",
  "CUSTOMER_PAYMENT",
  "PAYROLL_SALARY",
  "PAYROLL_PIECEWORK",
  "DEBRIS_REMOVAL",
];

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function PaymentsPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<PaymentType | "ALL">("ALL");
  const [descriptionFilter, setDescriptionFilter] = useState("");
  const [payablesError, setPayablesError] = useState<string | null>(null);
  const [markingPayableId, setMarkingPayableId] = useState<number | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<number | null>(null);

  const paymentsQuery = useQuery({
    queryKey: ["payments", filterType, descriptionFilter],
    queryFn: () =>
      fetchPayments({
        ...(filterType === "ALL" ? {} : { type: filterType as PaymentType }),
        description: descriptionFilter.trim() || undefined,
      }),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const {
    data: unpaidReceipts = [],
    isLoading: unpaidReceiptsLoading,
  } = useQuery({
    queryKey: ["receipts", "unpaid"],
    queryFn: () =>
      fetchReceipts({
        includePaid: false,
        limit: 500,
      }),
  });

  const selectedCustomerIdNumber = Number(formState.customerId);
  const hasCustomerForAllocation =
    formState.type === "CUSTOMER_PAYMENT" &&
    formState.applyToReceipts &&
    formState.customerId.trim().length > 0 &&
    !Number.isNaN(selectedCustomerIdNumber);

  const {
    data: customerReceipts = [],
    isLoading: customerReceiptsLoading,
  } = useQuery({
    queryKey: ["receipts", "customer-payment", formState.customerId, formState.type],
    queryFn: () =>
      fetchReceipts({
        customerId: selectedCustomerIdNumber,
        includePaid: true,
        limit: 500,
      }),
    enabled: hasCustomerForAllocation,
  });

  const payrollQuery = useInfiniteQuery<
    PayrollPageResult,
    Error,
    InfiniteData<PayrollPageResult, number | undefined>,
    readonly ["payroll", "paginated", "for-payments"],
    number | undefined
  >({
    queryKey: ["payroll", "paginated", "for-payments"] as const,
    queryFn: ({ pageParam }) => fetchPayrollPage({ cursor: pageParam, limit: 100 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });
  const payrollEntries = useMemo<PayrollEntry[]>(
    () => payrollQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [payrollQuery.data],
  );
  const hasMorePayroll = Boolean(payrollQuery.hasNextPage);
  const isFetchingMorePayroll = payrollQuery.isFetchingNextPage;
  const isPayrollLoading = payrollQuery.status === "pending";

  const { data: pendingDebris = [] } = useQuery({
    queryKey: ["debris", "PENDING"],
    queryFn: () => fetchDebris({ status: "PENDING" }),
  });

  const payablesQuery = useQuery({
    queryKey: ["inventory-payables"],
    queryFn: fetchInventoryPayables,
  });

  const createMutation = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      invalidatePaymentRelatedQueries();
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create payment");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof updatePayment>[1] }) =>
      updatePayment(id, payload),
    onSuccess: () => {
      invalidatePaymentRelatedQueries();
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update payment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePayment(id),
    onSuccess: (_data, id) => {
      invalidatePaymentRelatedQueries();
      if (editingPayment && editingPayment.id === id) {
        resetForm();
      }
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to delete payment");
    },
    onSettled: () => {
      setDeletingPaymentId(null);
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const markPayableMutation = useMutation({
    mutationFn: (id: number) => markInventoryEntryPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-payables"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-entries"] });
      setPayablesError(null);
    },
    onError: (err: any) => {
      setPayablesError(err?.response?.data?.error ?? err?.message ?? "Failed to mark purchase as paid");
    },
    onSettled: () => {
      setMarkingPayableId(null);
    },
  });

  function invalidatePaymentRelatedQueries() {
    queryClient.invalidateQueries({ queryKey: ["payments"] });
    queryClient.invalidateQueries({ queryKey: ["receipts", "paginated"] });
    queryClient.invalidateQueries({ queryKey: ["receipts", "unpaid"] });
    queryClient.invalidateQueries({ queryKey: ["receipts", "customer-payment"] });
    queryClient.invalidateQueries({ queryKey: ["payroll", "paginated"] });
    queryClient.invalidateQueries({ queryKey: ["debris", "PENDING"] });
  }

  const unlinkedPayrollEntries = useMemo(() => {
    return payrollEntries.filter((entry) => !entry.paymentId);
  }, [payrollEntries]);

  function resetForm() {
    setFormState(defaultForm);
    setFormError(null);
    setEditingPayment(null);
  }

  function handleMarkPayable(entryId: number) {
    setPayablesError(null);
    setMarkingPayableId(entryId);
    markPayableMutation.mutate(entryId);
  }

  function startEditingPayment(payment: Payment) {
    setEditingPayment(payment);
    setFormError(null);
    setFormState({
      date: payment.date ? payment.date.slice(0, 10) : "",
      amount: payment.amount.toString(),
      type: payment.type,
      description: payment.description ?? "",
      category: payment.category ?? "",
      reference: payment.reference ?? "",
      supplierId: payment.supplierId ? String(payment.supplierId) : "",
      customerId: payment.customerId ? String(payment.customerId) : "",
      receiptId: payment.receiptId ? String(payment.receiptId) : "",
      payrollEntryId: payment.payrollEntry?.id ? String(payment.payrollEntry.id) : "",
      debrisEntryId: payment.debrisRemoval?.id ? String(payment.debrisRemoval.id) : "",
      applyToReceipts: true,
    });
  }

  function handleDeletePayment(payment: Payment) {
    if (!window.confirm(`Delete payment #${payment.id}? This will undo linked effects.`)) {
      return;
    }
    setFormError(null);
    setDeletingPaymentId(payment.id);
    deleteMutation.mutate(payment.id);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const amount = Number(formState.amount);
    if (!formState.amount || Number.isNaN(amount) || amount <= 0) {
      setFormError("Enter a valid payment amount");
      return;
    }

    const payload = {
      date: formState.date || undefined,
      amount,
      type: formState.type,
      description: formState.description.trim() || undefined,
      category: formState.category.trim() || undefined,
      reference: formState.reference.trim() || undefined,
      supplierId:
        formState.supplierId && formState.type === "SUPPLIER"
          ? Number(formState.supplierId)
          : undefined,
      customerId:
        formState.customerId && formState.type === "CUSTOMER_PAYMENT"
          ? Number(formState.customerId)
          : undefined,
      receiptId:
        formState.receiptId && formState.type === "RECEIPT"
          ? Number(formState.receiptId)
          : undefined,
      payrollEntryId:
        formState.payrollEntryId &&
        (formState.type === "PAYROLL_SALARY" || formState.type === "PAYROLL_PIECEWORK")
          ? Number(formState.payrollEntryId)
          : undefined,
      debrisEntryId:
        formState.debrisEntryId && formState.type === "DEBRIS_REMOVAL"
          ? Number(formState.debrisEntryId)
          : undefined,
      applyToReceipts:
        formState.type === "CUSTOMER_PAYMENT" ? formState.applyToReceipts : undefined,
    };

    if (formState.type === "SUPPLIER" && !formState.supplierId) {
      setFormError("Select a supplier for supplier payments");
      return;
    }

    if (formState.type === "RECEIPT" && !formState.receiptId) {
      setFormError("Select a receipt to mark as paid");
      return;
    }

    if (
      (formState.type === "PAYROLL_SALARY" || formState.type === "PAYROLL_PIECEWORK") &&
      !formState.payrollEntryId
    ) {
      setFormError("Select a payroll entry to link this payment to");
      return;
    }

    if (formState.type === "DEBRIS_REMOVAL" && !formState.debrisEntryId) {
      setFormError("Select a debris entry to link this payment to");
      return;
    }

    if (formState.type === "CUSTOMER_PAYMENT" && !formState.customerId) {
      setFormError("Select a customer to apply this payment");
      return;
    }

    if (editingPayment) {
      updateMutation.mutate({ id: editingPayment.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const payments = paymentsQuery.data ?? [];
  const payablesSummary = payablesQuery.data;
  const outstandingPurchases = payablesSummary?.entries ?? [];
  const totalDue = payablesSummary?.totalDue ?? 0;

  const payrollErrorMessage =
    payrollQuery.status === "error"
      ? payrollQuery.error instanceof Error
        ? payrollQuery.error.message
        : "Failed to load payroll entries"
      : null;

  const filteredReceipts: Receipt[] = useMemo(() => {
    if (formState.type !== "RECEIPT") return unpaidReceipts;
    return unpaidReceipts;
  }, [formState.type, unpaidReceipts]);

  const payrollOptions = useMemo(() => {
    if (formState.type === "PAYROLL_SALARY" || formState.type === "PAYROLL_PIECEWORK") {
      return unlinkedPayrollEntries.filter((entry) =>
        formState.type === "PAYROLL_SALARY"
          ? entry.type === "SALARY"
          : entry.type === "PIECEWORK",
      );
    }
    return unlinkedPayrollEntries;
  }, [formState.type, unlinkedPayrollEntries]);

  const receiptFallbackOption =
    formState.type === "RECEIPT" &&
    formState.receiptId &&
    editingPayment?.receipt &&
    editingPayment.receipt.id === Number(formState.receiptId) &&
    !filteredReceipts.some((receipt) => receipt.id === Number(formState.receiptId))
      ? editingPayment.receipt
      : null;

  const payrollFallbackOption =
    (formState.type === "PAYROLL_SALARY" || formState.type === "PAYROLL_PIECEWORK") &&
    formState.payrollEntryId &&
    editingPayment?.payrollEntry &&
    editingPayment.payrollEntry.id === Number(formState.payrollEntryId) &&
    !payrollOptions.some((entry) => entry.id === editingPayment.payrollEntry!.id)
      ? editingPayment.payrollEntry
      : null;

  const debrisFallbackOption =
    formState.type === "DEBRIS_REMOVAL" &&
    formState.debrisEntryId &&
    editingPayment?.debrisRemoval &&
    editingPayment.debrisRemoval.id === Number(formState.debrisEntryId) &&
    !pendingDebris.some((entry) => entry.id === editingPayment.debrisRemoval!.id)
      ? editingPayment.debrisRemoval
      : null;

  const deleteInProgressId = deleteMutation.isPending ? deletingPaymentId : null;

  const customerPaymentPreview = useMemo(() => {
    if (formState.type !== "CUSTOMER_PAYMENT" || !formState.customerId) {
      return null;
    }
    const customerId = Number(formState.customerId);
    if (Number.isNaN(customerId)) {
      return null;
    }

    const outstanding = customerReceipts
      .filter((receipt) => receipt.customerId === customerId)
      .filter((receipt) => receipt.total - receipt.amountPaid > 1e-6)
      .sort((a, b) => {
        const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return a.id - b.id;
      });

    const paymentAmount = Number(formState.amount);
    if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
      return { outstanding, allocations: [], remaining: paymentAmount };
    }

    let remaining = paymentAmount;
    const allocations: { receipt: Receipt; applied: number; outstandingBefore: number }[] = [];

    for (const receipt of outstanding) {
      if (remaining <= 1e-6) {
        break;
      }
      const outstandingBefore = Math.max(0, receipt.total - receipt.amountPaid);
      if (outstandingBefore <= 1e-6) {
        continue;
      }
      const applied = Math.min(outstandingBefore, remaining);
      remaining -= applied;
      allocations.push({ receipt, applied, outstandingBefore });
    }

    return { outstanding, allocations, remaining: Math.max(remaining, 0) };
  }, [formState.type, formState.customerId, formState.amount, customerReceipts]);

  return (
    <section>
      <header>
        <h2>Payments & Expenses</h2>
        <p>Track outgoing cash, supplier payments, and payroll disbursements.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Payments</h3>
        <p>Filter and review recorded payments.</p>
        <div
          className="form-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            rowGap: 12,
            marginBottom: 16,
          }}
        >
          <label>
            Payment type
            <select
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as PaymentType | "ALL")}
            >
              <option value="ALL">All types</option>
              {paymentTypes.map((type) => (
                <option key={type} value={type}>
                  {type
                    .replace("PAYROLL_", "Payroll ")
                    .replace("GENERAL_EXPENSE", "General expense")
                    .replace("SUPPLIER", "Supplier")
                    .replace("RECEIPT", "Receipt")
                    .replace("CUSTOMER_PAYMENT", "Customer payment")
                    .replace("PIECEWORK", "piecework")
                    .replace("DEBRIS_REMOVAL", "Debris removal")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description contains
            <input
              type="text"
              value={descriptionFilter}
              onChange={(event) => setDescriptionFilter(event.target.value)}
              placeholder="e.g. diesel, payroll, rent…"
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setFilterType("ALL");
                setDescriptionFilter("");
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
        <h3 style={{ marginTop: 0 }}>Log payment</h3>
        {editingPayment ? (
          <div
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              Editing payment #{editingPayment.id} &middot; {editingPayment.type.replace("PAYROLL_", "Payroll ")}
            </span>
            <button type="button" className="ghost-button" onClick={resetForm}>
              Cancel editing
            </button>
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Amount *
            <input
              type="number"
              min="0"
              step="any"
              value={formState.amount}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, amount: event.target.value }))
              }
              placeholder="100.00"
              required
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={formState.date}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, date: event.target.value }))
              }
            />
          </label>
          <label>
            Payment type *
            <select
              value={formState.type}
              onChange={(event) =>
                setFormState((prev) => {
                  const nextType = event.target.value as PaymentType;
                  return {
                    ...prev,
                    type: nextType,
                    supplierId: nextType === "SUPPLIER" ? prev.supplierId : "",
                    receiptId: nextType === "RECEIPT" ? prev.receiptId : "",
                    customerId: nextType === "CUSTOMER_PAYMENT" ? prev.customerId : "",
                    payrollEntryId:
                      nextType === "PAYROLL_SALARY" || nextType === "PAYROLL_PIECEWORK"
                        ? prev.payrollEntryId
                        : "",
                    debrisEntryId: nextType === "DEBRIS_REMOVAL" ? prev.debrisEntryId : "",
                  };
                })
              }
            >
          {paymentTypes.map((type) => (
            <option key={type} value={type}>
              {type
                .replace("PAYROLL_", "Payroll ")
                .replace("GENERAL_EXPENSE", "General expense")
                .replace("SUPPLIER", "Supplier")
                .replace("RECEIPT", "Receipt")
                .replace("CUSTOMER_PAYMENT", "Customer payment")
                .replace("PIECEWORK", "piecework")
                .replace("DEBRIS_REMOVAL", "Debris removal")}
            </option>
          ))}
        </select>
      </label>
          <label>
            Description
            <input
              value={formState.description}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Optional description"
            />
          </label>
          <label>
            Category / tag
            <input
              value={formState.category}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, category: event.target.value }))
              }
              placeholder="Tax, municipal fee, etc."
            />
          </label>
          <label>
            Reference
            <input
              value={formState.reference}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, reference: event.target.value }))
              }
              placeholder="Cheque #, bank ref, etc."
            />
          </label>

          {formState.type === "SUPPLIER" && (
            <label>
              Supplier *
              <select
                value={formState.supplierId}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, supplierId: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select supplier
                </option>
                {suppliers.map((supplier: Supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {formState.type === "RECEIPT" && (
            <label>
              Receipt *
              <select
                value={formState.receiptId}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, receiptId: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select receipt
                </option>
                {receiptFallbackOption ? (
                  <option value={receiptFallbackOption.id}>
                    {receiptFallbackOption.receiptNo ?? `#${receiptFallbackOption.id}`} (linked)
                  </option>
                ) : null}
                {filteredReceipts.map((receipt: Receipt) => (
                  <option key={receipt.id} value={receipt.id}>
                    {receipt.receiptNo} – ${receipt.total.toFixed(2)} – {receipt.customer?.name ?? receipt.walkInName ?? "Walk-in"}
                  </option>
                ))}
              </select>
              {unpaidReceiptsLoading ? (
                <small style={{ color: "var(--color-muted)" }}>Loading unpaid receipts…</small>
              ) : filteredReceipts.length === 0 ? (
                <small style={{ color: "var(--color-muted)" }}>No unpaid receipts available.</small>
              ) : null}
            </label>
          )}

          {formState.type === "CUSTOMER_PAYMENT" && (
            <label>
              Customer *
              <select
                value={formState.customerId}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, customerId: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select customer
                </option>
                {customers.map((customer: Customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {formState.type === "CUSTOMER_PAYMENT" ? (
            <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={formState.applyToReceipts}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, applyToReceipts: event.target.checked }))
                }
              />
              Apply automatically to outstanding receipts
            </label>
          ) : null}

          {formState.type === "CUSTOMER_PAYMENT" && formState.applyToReceipts && formState.customerId ? (
            <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#555" }}>
              {customerReceiptsLoading ? (
                <div>Loading customer receipts…</div>
              ) : customerPaymentPreview && customerPaymentPreview.outstanding.length > 0 ? (
                <>
                  <div>
                    Outstanding (oldest first):
                    {" "}
                    {customerPaymentPreview.outstanding
                      .map((receipt) => {
                        const remaining = Math.max(0, receipt.total - receipt.amountPaid);
                        const label = receipt.receiptNo || `#${receipt.id}`;
                        return `${label} ($${remaining.toFixed(2)} due)`;
                      })
                      .join(" • ")}
                  </div>
                  {customerPaymentPreview.allocations.length > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      Payment preview:
                      {" "}
                      {customerPaymentPreview.allocations
                        .map((entry) => {
                          const label = entry.receipt.receiptNo || `#${entry.receipt.id}`;
                          const remainingAfter = Math.max(0, entry.outstandingBefore - entry.applied);
                          const status =
                            remainingAfter > 1e-6
                              ? `${remainingAfter.toFixed(2)} due after`
                              : "paid in full";
                          return `${label} → $${entry.applied.toFixed(2)} (${status})`;
                        })
                        .join(" • ")}
                      {customerPaymentPreview.remaining > 1e-6
                        ? ` • $${customerPaymentPreview.remaining.toFixed(2)} unallocated`
                        : ""}
                    </div>
                  ) : null}
                </>
              ) : (
                <div>No outstanding invoices for this customer.</div>
              )}
            </div>
          ) : null}

          {(formState.type === "PAYROLL_SALARY" || formState.type === "PAYROLL_PIECEWORK") && (
            <>
              <label>
                Payroll entry *
                <select
                  value={formState.payrollEntryId}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, payrollEntryId: event.target.value }))
                  }
                  required
                  disabled={isPayrollLoading && payrollOptions.length === 0}
                >
                  <option value="" disabled>
                    {isPayrollLoading && payrollOptions.length === 0
                      ? "Loading payroll entries…"
                      : "Select payroll entry"}
                  </option>
                  {payrollFallbackOption ? (
                    <option value={payrollFallbackOption.id}>
                      {`${payrollFallbackOption.employee.name} – $${payrollFallbackOption.amount.toFixed(2)} (linked)`}
                    </option>
                  ) : null}
                  {payrollOptions.map((entry: PayrollEntry) => {
                    const descriptor =
                      entry.type === "SALARY"
                        ? "Salary"
                        : `${entry.quantity ?? 0} units`;
                    return (
                      <option key={entry.id} value={entry.id}>
                        {`${entry.employee.name} – $${entry.amount.toFixed(2)} (${descriptor})`}
                      </option>
                    );
                  })}
                </select>
                {isPayrollLoading && payrollOptions.length > 0 ? (
                  <small style={{ color: "var(--color-muted)", marginTop: 4 }}>
                    Loading more payroll entries…
                  </small>
                ) : null}
                {!isPayrollLoading && payrollOptions.length === 0 ? (
                  <small style={{ color: "var(--color-muted)", marginTop: 4 }}>
                    All payroll entries are already linked to payments.
                  </small>
                ) : null}
                {payrollErrorMessage ? (
                  <div className="error-text" style={{ marginTop: 4 }}>
                    {payrollErrorMessage}
                  </div>
                ) : null}
              </label>
              {hasMorePayroll ? (
                <div style={{ gridColumn: "1 / -1", marginTop: -4 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => payrollQuery.fetchNextPage()}
                    disabled={isFetchingMorePayroll}
                  >
                    {isFetchingMorePayroll ? "Loading more payroll entries…" : "Load more payroll entries"}
                  </button>
                </div>
              ) : null}
            </>
          )}

          {formState.type === "DEBRIS_REMOVAL" && (
            <label>
              Debris entry *
              <select
                value={formState.debrisEntryId}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, debrisEntryId: event.target.value }))
                }
                required
              >
                <option value="" disabled>
                  Select debris entry
                </option>
                {debrisFallbackOption ? (
                  <option value={debrisFallbackOption.id}>
                    {new Date(debrisFallbackOption.date).toLocaleDateString()} – {debrisFallbackOption.customer?.name ?? debrisFallbackOption.walkInName ?? "Walk-in"} ({debrisFallbackOption.volume.toFixed(3)} m³, linked)
                  </option>
                ) : null}
                {pendingDebris.map((entry: DebrisEntry) => (
                  <option key={entry.id} value={entry.id}>
                    {new Date(entry.date).toLocaleDateString()} – {entry.customer?.name ?? entry.walkInName ?? "Walk-in"} ({entry.volume.toFixed(3)} m³)
                  </option>
                ))}
              </select>
            </label>
          )}

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving
                ? editingPayment
                  ? "Updating..."
                  : "Saving..."
                : editingPayment
                  ? "Update payment"
                  : "Save payment"}
            </button>
            <button type="button" className="secondary-button" onClick={resetForm}>
              {editingPayment ? "Cancel editing" : "Reset"}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>Recent payments</h3>
          <select value={filterType} onChange={(event) => setFilterType(event.target.value as any)}>
            <option value="ALL">All types</option>
            {paymentTypes.map((type) => (
              <option key={type} value={type}>
                {type
                  .replace("PAYROLL_", "Payroll ")
                  .replace("GENERAL_EXPENSE", "General expense")
                  .replace("SUPPLIER", "Supplier")
                  .replace("RECEIPT", "Receipt")
                  .replace("CUSTOMER_PAYMENT", "Customer payment")
                  .replace("PIECEWORK", "piecework")
                  .replace("DEBRIS_REMOVAL", "Debris removal")}
              </option>
            ))}
          </select>
        </div>

        {paymentsQuery.isLoading ? (
          <p>Loading payments…</p>
        ) : payments.length === 0 ? (
          <p>No payments recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Category</th>
                <th>Reference</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment: Payment) => {
                const appliedReceipts = (payment.receiptPayments ?? [])
                  .filter((link) => link.amount > 0)
                  .map((link) => {
                    const label = link.receipt?.receiptNo || `#${link.receiptId}`;
                    return `${label} ($${link.amount.toFixed(2)})`;
                  });

                return (
                  <tr key={payment.id}>
                    <td>{new Date(payment.date).toLocaleDateString()}</td>
                    <td>{payment.type}</td>
                    <td>${payment.amount.toFixed(2)}</td>
                    <td>
                      {payment.description && payment.description.trim().length > 0
                        ? payment.description
                        : "—"}
                      {payment.type === "SUPPLIER" && payment.supplier
                        ? ` • ${payment.supplier.name}`
                        : null}
                      {payment.type === "RECEIPT" && payment.receipt
                        ? ` • Receipt ${payment.receipt.receiptNo}`
                        : null}
                      {(payment.type === "PAYROLL_SALARY" || payment.type === "PAYROLL_PIECEWORK") &&
                      payment.payrollEntry
                        ? ` • ${payment.payrollEntry.employee.name}`
                        : null}
                      {payment.type === "DEBRIS_REMOVAL" && payment.debrisRemoval
                        ? ` • Debris ${payment.debrisRemoval.id} (${payment.debrisRemoval.volume.toFixed(3)} m³)`
                        : null}
                      {payment.type === "CUSTOMER_PAYMENT" && payment.customer
                        ? ` • ${payment.customer.name}`
                        : null}
                      {appliedReceipts.length > 0
                        ? ` • Applied to ${appliedReceipts.join(", ")}`
                        : null}
                    </td>
                    <td>{payment.category ?? "—"}</td>
                    <td>{payment.reference ?? "—"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => startEditingPayment(payment)}
                          disabled={editingPayment?.id === payment.id}
                        >
                          {editingPayment?.id === payment.id ? "Editing" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => handleDeletePayment(payment)}
                          disabled={deleteInProgressId === payment.id}
                        >
                          {deleteInProgressId === payment.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Outstanding supplier purchases</h3>
        {payablesQuery.isLoading ? (
          <p>Loading outstanding purchases…</p>
        ) : outstandingPurchases.length === 0 ? (
          <p>All purchase entries are marked as paid.</p>
        ) : (
          <>
            <p style={{ fontWeight: 600 }}>Total due: {formatCurrency(totalDue)}</p>
            {payablesError && <div className="error-text">{payablesError}</div>}
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Unit cost</th>
                  <th>Outstanding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {outstandingPurchases.map((entry) => {
                  const disabled = markPayableMutation.isPending && markingPayableId === entry.id;
                  return (
                    <tr key={entry.id}>
                      <td>{new Date(entry.entryDate ?? entry.createdAt).toLocaleDateString()}</td>
                      <td>{entry.supplier?.name ?? "—"}</td>
                      <td>{entry.product.name}</td>
                      <td>{entry.quantity.toLocaleString()}</td>
                      <td>{entry.unitCost !== null && entry.unitCost !== undefined ? formatCurrency(entry.unitCost) : "—"}</td>
                      <td>
                        {entry.outstanding !== null && entry.outstanding !== undefined
                          ? formatCurrency(entry.outstanding)
                          : entry.totalCost !== null && entry.totalCost !== undefined
                            ? formatCurrency(entry.totalCost)
                            : "—"}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => handleMarkPayable(entry.id)}
                            disabled={disabled}
                          >
                            {disabled ? "Marking…" : "Mark paid"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

export default PaymentsPage;
