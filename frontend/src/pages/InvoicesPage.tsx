import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchCustomers } from "../api/customers";
import { fetchReceipts } from "../api/receipts";
import {
  createInvoice,
  createInvoicePreview,
  deleteInvoice,
  fetchInvoices,
  markInvoicePaid,
  type InvoicePreviewPayload,
} from "../api/invoices";
import { fetchJobSites } from "../api/jobSites";
import type { Customer, InvoicePreview, InvoiceRecord, JobSite } from "../types";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

type Mode = "pick" | "amount";

type MissingPriceItem = {
  key: string;
  receiptId: number;
  receiptNo?: string | null;
  itemId: number;
  productName: string;
  quantity: number;
  baseUnit?: string | null;
  displayQuantity?: number | null;
  displayUnit?: string | null;
};

export function InvoicesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: fetchInvoices,
  });
  const invoices = invoicesQuery.data ?? [];
  const invoiceListError = (invoicesQuery.error as Error | null) ?? null;
  const refreshInvoices = () => {
    invoicesQuery.refetch();
  };

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("pick");
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<number[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [savedInvoice, setSavedInvoice] = useState<InvoiceRecord | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [includePaid, setIncludePaid] = useState<boolean>(false);
  const [startDateFilter, setStartDateFilter] = useState<string>("");
  const [endDateFilter, setEndDateFilter] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvoicePreview | InvoiceRecord | null>(null);
  const [lastPreviewRequest, setLastPreviewRequest] = useState<InvoicePreviewPayload | null>(null);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [jobSiteId, setJobSiteId] = useState<string>("");

  const hasSelectedCustomer =
    selectedCustomerId.trim().length > 0 && !Number.isNaN(Number(selectedCustomerId));

  const {
    data: receipts = [],
    isLoading: receiptsLoading,
  } = useQuery({
    queryKey: [
      "receipts",
      "customer",
      selectedCustomerId || "none",
      includePaid,
      startDateFilter || "no-start",
      endDateFilter || "no-end",
    ],
    queryFn: () =>
      hasSelectedCustomer
        ? fetchReceipts({
            customerId: Number(selectedCustomerId),
            includePaid,
            limit: 500,
            startDate: startDateFilter || undefined,
            endDate: endDateFilter || undefined,
          })
        : [],
    enabled: hasSelectedCustomer,
  });

  const { data: jobSites = [] } = useQuery<JobSite[]>({
    queryKey: ["job-sites"],
    queryFn: () => fetchJobSites(),
  });

  const filteredJobSites = useMemo(() => {
    const customerIdNumber = Number(selectedCustomerId);
    if (!selectedCustomerId || Number.isNaN(customerIdNumber)) return [];
    return jobSites.filter((site) => site.customerId === customerIdNumber);
  }, [jobSites, selectedCustomerId]);

  const customerReceipts = useMemo(() => {
    const customerIdNumber = Number(selectedCustomerId);
    if (!selectedCustomerId || Number.isNaN(customerIdNumber)) return [];
    const jobSiteIdNumber =
      jobSiteId && jobSiteId.trim().length > 0 && !Number.isNaN(Number(jobSiteId))
        ? Number(jobSiteId)
        : null;
    return receipts
      .filter((receipt) => receipt.customerId === customerIdNumber)
      .filter((receipt) => (jobSiteIdNumber !== null ? receipt.jobSiteId === jobSiteIdNumber : true))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [receipts, selectedCustomerId, jobSiteId]);

  const receiptTypeLookup = useMemo(() => {
    const map = new Map<number, string>();
    customerReceipts.forEach((receipt) => {
      map.set(receipt.id, receipt.type);
    });
    return map;
  }, [customerReceipts]);

  const invoiceTotals = useMemo(() => {
    if (!preview) return null;
    const receiptType = preview.invoice.receiptType ?? preview.invoice.receipts[0]?.type ?? "NORMAL";
    const isTVA = receiptType === "TVA";
    const vatRate = preview.invoice.vatRate ?? (isTVA ? 0.11 : 0);
    const vatAmount = isTVA
      ? preview.invoice.vatAmount ?? Math.round(preview.invoice.subtotal * vatRate * 100) / 100
      : 0;
    const totalWithVat = preview.invoice.totalWithVat ?? preview.invoice.subtotal + vatAmount;
    const outstanding =
      preview.invoice.outstanding ??
      Math.max(totalWithVat - (preview.invoice.amountPaid ?? 0), 0);
    return {
      receiptType,
      isTVA,
      vatRate,
      vatAmount,
      subtotal: preview.invoice.subtotal,
      totalWithVat,
      outstanding,
      oldBalance: preview.invoice.oldBalance ?? 0,
    };
  }, [preview]);

  const selectionHasSingleType = (ids: number[]) => {
    const types = new Set(
      ids
        .map((receiptId) => receiptTypeLookup.get(receiptId))
        .filter((value): value is string => Boolean(value)),
    );
    return types.size <= 1;
  };

  const previewMutation = useMutation({
    mutationFn: ({ customerId, payload }: { customerId: number; payload: InvoicePreviewPayload }) =>
      createInvoicePreview(customerId, payload),
    onSuccess: (data) => {
      setPreview(data);
      setFormError(null);
      setSavedInvoice(null);
      setActionError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to build invoice preview");
      setPreview(null);
    },
  });

  const createInvoiceMutation = useMutation<
    InvoiceRecord,
    unknown,
    { customerId: number; payload: InvoicePreviewPayload }
  >({
    mutationFn: ({ customerId, payload }) => createInvoice(customerId, payload),
    onSuccess: (invoice) => {
      setSavedInvoice(invoice);
      setPreview(invoice);
      setActionError(null);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["report-summary"] });
    },
    onError: (err: any) => {
      setActionError(err?.response?.data?.error ?? err?.message ?? "Failed to save invoice");
    },
  });

  const markInvoicePaidMutation = useMutation<
    InvoiceRecord,
    unknown,
    { id: number; paidAt?: string }
  >({
    mutationFn: ({ id, paidAt }) => markInvoicePaid(id, paidAt),
    onSuccess: (invoice) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["report-summary"] });
      setPreview((current) => {
        if (current && "id" in current && current.id === invoice.id) {
          return invoice;
        }
        return current;
      });
      if (savedInvoice?.id === invoice.id) {
        setSavedInvoice(invoice);
      }
    },
    onError: (err: any) => {
      setActionError(err?.response?.data?.error ?? err?.message ?? "Failed to mark invoice as paid");
    },
  });

  const deleteInvoiceMutation = useMutation<void, unknown, number>({
    mutationFn: (id) => deleteInvoice(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["report-summary"] });
    },
    onError: (err: any) => {
      setActionError(err?.response?.data?.error ?? err?.message ?? "Failed to delete invoice");
    },
  });

  const isSavingInvoice = createInvoiceMutation.isPending;
  const markingInvoiceId = markInvoicePaidMutation.variables?.id;
  const deletingInvoiceId = deleteInvoiceMutation.variables;

  const missingPriceItems = useMemo<MissingPriceItem[]>(() => {
    if (!preview) return [];
    const items: MissingPriceItem[] = [];
    preview.invoice.receipts.forEach((receipt) => {
      receipt.items.forEach((item) => {
        if (item.unitPrice === null || item.unitPrice === undefined) {
          items.push({
            key: `${receipt.id}:${item.id}`,
            receiptId: receipt.id,
            receiptNo: receipt.receiptNo ?? `#${receipt.id}`,
            itemId: item.id,
            productName: item.product?.name ?? "Item",
            quantity: item.quantity,
            baseUnit: item.product?.unit,
            displayQuantity: item.displayQuantity ?? null,
            displayUnit: item.displayUnit ?? null,
          });
        }
      });
    });
    return items;
  }, [preview]);

  useEffect(() => {
    if (!preview) {
      setPriceInputs({});
      return;
    }
    setPriceInputs((prev) => {
      const next: Record<string, string> = {};
      preview.invoice.receipts.forEach((receipt) => {
        receipt.items.forEach((item) => {
          if (item.unitPrice === null || item.unitPrice === undefined) {
            const key = `${receipt.id}:${item.id}`;
            next[key] = prev[key] ?? "";
          }
        });
      });
      return next;
    });
  }, [preview]);

  const pricingInputsValid =
    missingPriceItems.length > 0
      ? missingPriceItems.every((item) => {
          const value = priceInputs[item.key];
          if (value === undefined || value.trim().length === 0) {
            return false;
          }
          const parsed = Number(value);
          return !Number.isNaN(parsed) && parsed >= 0;
        })
      : false;
  const canSaveInvoice =
    Boolean(preview && lastPreviewRequest && missingPriceItems.length === 0 && !savedInvoice);

  function toggleReceipt(id: number) {
    setSelectedReceiptIds((prev) => {
      const next = prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id];
      if (!selectionHasSingleType(next)) {
        setSelectionError("Invoices cannot mix NORMAL and TVA receipts. Deselect one receipt type.");
        return prev;
      }
      setSelectionError(null);
      return next;
    });
  }

  const handleSelectAllReceipts = () => {
    const ids = customerReceipts.map((receipt) => receipt.id);
    if (!selectionHasSingleType(ids)) {
      setSelectionError("Receipts must all be NORMAL or all TVA for a single invoice.");
      return;
    }
    setSelectionError(null);
    setSelectedReceiptIds(ids);
  };

  const clearReceiptSelection = () => {
    setSelectedReceiptIds([]);
    setSelectionError(null);
  };

  function resetSelections() {
    setSelectedReceiptIds([]);
    setAmount("");
    setPreview(null);
    setLastPreviewRequest(null);
    setPriceInputs({});
    setFormError(null);
    setSelectionError(null);
     setSavedInvoice(null);
     setActionError(null);
    previewMutation.reset();
  }

  function buildPriceOverridePayload():
    | {
        receiptId: number;
        items: { itemId: number; unitPrice: number }[];
      }[]
    | null {
    if (missingPriceItems.length === 0) {
      return null;
    }
    const grouped: Record<number, { itemId: number; unitPrice: number }[]> = {};
    for (const entry of missingPriceItems) {
      const rawValue = priceInputs[entry.key];
      if (rawValue === undefined || rawValue.trim().length === 0) {
        setFormError("Enter a price for each highlighted line item before applying.");
        return null;
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed) || parsed < 0) {
        setFormError("Prices must be numbers greater than or equal to 0.");
        return null;
      }
      if (!grouped[entry.receiptId]) {
        grouped[entry.receiptId] = [];
      }
      grouped[entry.receiptId].push({ itemId: entry.itemId, unitPrice: parsed });
    }
    return Object.entries(grouped).map(([receiptId, items]) => ({
      receiptId: Number(receiptId),
      items,
    }));
  }

  function handleApplyPricing() {
    if (!preview || !lastPreviewRequest) {
      return;
    }
    const overrides = buildPriceOverridePayload();
    if (!overrides || overrides.length === 0) {
      return;
    }
    setFormError(null);
    previewMutation.mutate({
      customerId: preview.customer.id,
      payload: {
        ...lastPreviewRequest,
        priceOverrides: overrides,
      },
    });
  }

  function handlePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setActionError(null);
    if (savedInvoice) {
      setSavedInvoice(null);
    }

    const customerIdNumber = Number(selectedCustomerId);
    if (!selectedCustomerId || Number.isNaN(customerIdNumber)) {
      setFormError("Select a customer first");
      return;
    }

    if (mode === "pick" && selectedReceiptIds.length === 0) {
      setFormError("Select at least one receipt");
      return;
    }

    if (mode === "amount") {
      const amountNumber = Number(amount);
      if (!amount || Number.isNaN(amountNumber) || amountNumber <= 0) {
        setFormError("Enter a valid amount");
        return;
      }
    }

    const jobSiteIdNumber =
      jobSiteId && jobSiteId.trim().length > 0 && !Number.isNaN(Number(jobSiteId))
        ? Number(jobSiteId)
        : undefined;

    const payload =
      mode === "pick"
        ? { receiptIds: selectedReceiptIds, includePaid, jobSiteId: jobSiteIdNumber }
        : { amount: Number(amount), includePaid, jobSiteId: jobSiteIdNumber };

    setLastPreviewRequest(payload);
    setPriceInputs({});
    previewMutation.mutate({ customerId: customerIdNumber, payload });
  }

  function handleSaveInvoice() {
    if (!preview || !lastPreviewRequest) {
      setActionError("Preview the invoice before saving it.");
      return;
    }
    if (missingPriceItems.length > 0) {
      setActionError("Set prices for all invoice items before saving.");
      return;
    }
    if (savedInvoice) {
      return;
    }
    setActionError(null);
    createInvoiceMutation.mutate({
      customerId: preview.customer.id,
      payload: {
        ...lastPreviewRequest,
        jobSiteId:
          jobSiteId && jobSiteId.trim().length > 0 && !Number.isNaN(Number(jobSiteId))
            ? Number(jobSiteId)
            : undefined,
      },
    });
  }

  function handlePrint({ totalsOnly = false }: { totalsOnly?: boolean } = {}) {
    if (!preview) return;
    if (missingPriceItems.length > 0 && !savedInvoice) {
      setFormError("Set prices for all invoice line items before printing.");
      return;
    }
    if (savedInvoice) {
      const search = new URLSearchParams();
      search.set("invoiceId", String(savedInvoice.id));
      if (totalsOnly) search.set("totals", "1");
      navigate(`/invoices/print?${search.toString()}`);
      return;
    }
    const customerId = preview.customer.id;
    if (mode === "pick") {
      const params = new URLSearchParams();
      selectedReceiptIds.forEach((id) => params.append("receiptId", String(id)));
      params.set("customerId", String(customerId));
      params.set("includePaid", includePaid ? "1" : "0");
      if (totalsOnly) params.set("totals", "1");
      navigate(`/invoices/print?${params.toString()}`);
    } else {
      const params = new URLSearchParams({
        customerId: String(customerId),
        amount: amount,
        includePaid: includePaid ? "1" : "0",
      });
      if (totalsOnly) params.set("totals", "1");
      navigate(`/invoices/print?${params.toString()}`);
    }
  }

  function handleMarkInvoicePaid(invoice: InvoiceRecord) {
    if (invoice.status === "PAID") return;
    const label = invoice.invoiceNo ?? `#${invoice.id}`;
    if (!window.confirm(`Mark invoice ${label} as paid?`)) {
      return;
    }
    setActionError(null);
    markInvoicePaidMutation.mutate({ id: invoice.id });
  }

  function handleDeleteInvoice(invoice: InvoiceRecord) {
    if (!isAdmin) return;
    const label = invoice.invoiceNo ?? `#${invoice.id}`;
    if (
      !window.confirm(
        `Delete invoice ${label}? Linked receipts will become available for new invoices.`,
      )
    ) {
      return;
    }
    setActionError(null);
    deleteInvoiceMutation.mutate(invoice.id);
  }

  return (
    <section>
      <header>
        <h2>Invoice Builder</h2>
        <p>Select a customer and either choose specific receipts or invoice by target amount. Generate a printable invoice instantly.</p>
      </header>

      <div className="section-card">
        <form onSubmit={handlePreview} className="form-grid two-columns">
          <label>
            Customer *
            <select
              value={selectedCustomerId}
              onChange={(event) => {
                setSelectedCustomerId(event.target.value);
                resetSelections();
                setJobSiteId("");
              }}
            >
              <option value="">Select customer</option>
              {customers.map((customer: Customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Job site (optional)
            <select
              value={jobSiteId}
              onChange={(e) => setJobSiteId(e.target.value)}
              disabled={!hasSelectedCustomer}
            >
              <option value="">None</option>
              {filteredJobSites.map((site: JobSite) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Mode
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as Mode);
                setSelectedReceiptIds([]);
                setAmount("");
                setPreview(null);
              }}
            >
              <option value="pick">Select receipts</option>
              <option value="amount">Invoice by amount</option>
            </select>
          </label>

          <label>
            Include paid receipts
            <input
              type="checkbox"
              checked={includePaid}
              onChange={(event) => setIncludePaid(event.target.checked)}
            />
          </label>

          <label>
            Start date
            <input
              type="date"
              value={startDateFilter}
              onChange={(event) => {
                setStartDateFilter(event.target.value);
                resetSelections();
              }}
            />
          </label>

          <label>
            End date
            <input
              type="date"
              value={endDateFilter}
              onChange={(event) => {
                setEndDateFilter(event.target.value);
                resetSelections();
              }}
            />
          </label>

          {mode === "amount" ? (
            <label>
              Target amount *
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="500.00"
              />
            </label>
          ) : null}

          {mode === "pick" && hasSelectedCustomer ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <h3 style={{ marginTop: 16 }}>Receipts for {customers.find((c) => c.id === Number(selectedCustomerId))?.name}</h3>
              <p style={{ color: "var(--color-muted)", marginBottom: 12 }}>
                Select any receipts you wish to include in this invoice. Oldest receipts are listed first.
              </p>
              {customerReceipts.length > 0 ? (
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleSelectAllReceipts}
                  >
                    Select all
                  </button>
                  {selectedReceiptIds.length > 0 ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={clearReceiptSelection}
                    >
                      Clear selection
                    </button>
                  ) : null}
                </div>
              ) : null}
              {selectionError ? (
                <p className="error-text" style={{ marginTop: 0 }}>
                  {selectionError}
                </p>
              ) : null}
              {receiptsLoading ? (
                <p style={{ marginBottom: 0 }}>Loading receipts…</p>
              ) : customerReceipts.length === 0 ? (
                <p style={{ marginBottom: 0 }}>
                  {includePaid ? "No receipts found for this customer." : "No unpaid receipts for this customer."}
                </p>
              ) : (
                <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>Date</th>
                        <th>Receipt #</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerReceipts.map((receipt) => {
                        const checked = selectedReceiptIds.includes(receipt.id);
                        const needsPricing = receipt.items.some(
                          (item) => item.unitPrice === null || item.unitPrice === undefined,
                        );
                        return (
                          <tr key={receipt.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleReceipt(receipt.id)}
                              />
                            </td>
                            <td>{new Date(receipt.date).toLocaleDateString()}</td>
                            <td>{receipt.receiptNo ?? `#${receipt.id}`}</td>
                            <td>{needsPricing ? "Pending pricing" : formatCurrency(receipt.total)}</td>
                            <td>
                              <div>{receipt.isPaid ? "Paid" : "Pending"}</div>
                              {needsPricing ? (
                                <span style={{ display: "inline-block", marginTop: 4, fontSize: "0.75rem", color: "var(--color-accent)" }}>
                                  Needs pricing
                                </span>
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
          ) : null}

          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={previewMutation.isPending}>
              {previewMutation.isPending ? "Building preview…" : "Preview invoice"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                resetSelections();
                queryClient.invalidateQueries({ queryKey: ["report-summary"] });
              }}
            >
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

      {preview ? (
        <div className="section-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 style={{ marginTop: 0 }}>Invoice preview</h3>
              <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>
                Generated {new Date(preview.generatedAt).toLocaleString()} for <strong>{preview.customer.name}</strong>.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!savedInvoice ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSaveInvoice}
                  disabled={!canSaveInvoice || isSavingInvoice}
                >
                  {isSavingInvoice ? "Saving…" : "Save invoice"}
                </button>
              ) : null}
              <button
                type="button"
                className="primary-button"
                onClick={() => handlePrint()}
                disabled={missingPriceItems.length > 0 && !savedInvoice}
              >
                {savedInvoice
                  ? "Print saved invoice"
                  : missingPriceItems.length > 0
                  ? "Set prices to print"
                  : "Print invoice"}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => handlePrint({ totalsOnly: true })}
                disabled={missingPriceItems.length > 0 && !savedInvoice}
              >
                Print totals summary
              </button>
            </div>
          </div>
          {actionError ? (
            <p className="error-text" style={{ marginTop: 0 }}>
              {actionError}
            </p>
          ) : null}
          {savedInvoice ? (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                padding: 16,
                marginTop: 8,
                background: "var(--color-surface-secondary)",
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  Invoice {savedInvoice.invoiceNo ?? `#${savedInvoice.id}`} saved
                </div>
                <p style={{ margin: "4px 0 0", color: "var(--color-muted)" }}>
                  Status: {savedInvoice.status}
                </p>
                <p style={{ margin: "4px 0 0", color: "var(--color-muted)" }}>
                  Old balance: {formatCurrency(savedInvoice.invoice.oldBalance ?? 0)}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => navigate(`/invoices/print?invoiceId=${savedInvoice.id}`)}
                >
                  Print invoice
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => navigate(`/invoices/print?invoiceId=${savedInvoice.id}&totals=1`)}
                >
                  Print totals summary
                </button>
                {savedInvoice.status !== "PAID" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleMarkInvoicePaid(savedInvoice)}
                    disabled={
                      markInvoicePaidMutation.isPending && markingInvoiceId === savedInvoice.id
                    }
                  >
                    {markInvoicePaidMutation.isPending && markingInvoiceId === savedInvoice.id
                      ? "Marking…"
                      : "Mark paid"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {missingPriceItems.length > 0 ? (
            <p style={{ color: "var(--color-muted)", marginTop: 8 }}>
              Complete pricing for the highlighted items before printing the invoice.
            </p>
          ) : null}

          {missingPriceItems.length > 0 ? (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 24,
                background: "var(--color-surface-secondary)",
              }}
            >
              <h4 style={{ marginTop: 0 }}>Set pricing for pending items</h4>
              <p style={{ color: "var(--color-muted)", marginTop: 4 }}>
                Enter the unit price for each line. Saved prices update the receipts automatically.
              </p>
              <div className="form-grid two-columns" style={{ marginTop: 16 }}>
                {missingPriceItems.map((item) => {
                  const value = priceInputs[item.key] ?? "";
                  const quantityText =
                    item.displayQuantity !== null && item.displayQuantity !== undefined && item.displayUnit
                      ? `${item.displayQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${item.displayUnit}`
                      : `${item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${
                          item.baseUnit ? ` ${item.baseUnit}` : ""
                        }`;
                  return (
                    <label key={item.key}>
                      <span style={{ fontWeight: 600 }}>{item.receiptNo}</span>
                      <div style={{ color: "var(--color-text)", marginBottom: 4 }}>{item.productName}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: 8 }}>
                        {quantityText}
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={value}
                        onChange={(event) =>
                          setPriceInputs((prev) => ({
                            ...prev,
                            [item.key]: event.target.value,
                          }))
                        }
                        placeholder="Price per base unit"
                      />
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleApplyPricing}
                  disabled={!pricingInputsValid || previewMutation.isPending}
                >
                  {previewMutation.isPending ? "Saving…" : "Apply pricing"}
                </button>
              </div>
            </div>
          ) : null}

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt #</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.invoice.receipts.map((receipt) => {
                const needsPricing = receipt.items.some(
                  (item) => item.unitPrice === null || item.unitPrice === undefined,
                );
                const balanceValue = Math.max(0, receipt.total - receipt.amountPaid);
                return (
                  <tr key={receipt.id}>
                    <td>{new Date(receipt.date).toLocaleDateString()}</td>
                    <td>{receipt.receiptNo ?? `#${receipt.id}`}</td>
                    <td>{needsPricing ? "Pending pricing" : formatCurrency(receipt.total)}</td>
                    <td>{needsPricing ? "—" : formatCurrency(balanceValue)}</td>
                    <td>
                      {needsPricing
                        ? "Pending pricing"
                        : balanceValue <= 1e-6
                        ? "Paid in full"
                        : `${formatCurrency(balanceValue)} due`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 16 }}>
            <div>
              <div>Subtotal</div>
              {invoiceTotals?.isTVA ? (
                <div>VAT ({((invoiceTotals.vatRate ?? 0) * 100).toFixed(0)}%)</div>
              ) : null}
              <div>Total (incl. VAT)</div>
              <div style={{ fontWeight: 600 }}>Outstanding</div>
              <div style={{ fontWeight: 600 }}>Old balance (other receipts)</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div>
                {missingPriceItems.length > 0 || !invoiceTotals
                  ? "Pending pricing"
                  : formatCurrency(invoiceTotals.subtotal)}
              </div>
              {invoiceTotals?.isTVA ? (
                <div>
                  {missingPriceItems.length > 0
                    ? "Pending pricing"
                    : formatCurrency(invoiceTotals.vatAmount)}
                </div>
              ) : null}
              <div>
                {missingPriceItems.length > 0 || !invoiceTotals
                  ? "Pending pricing"
                  : formatCurrency(invoiceTotals.totalWithVat)}
              </div>
              <div style={{ fontWeight: 600 }}>
                {missingPriceItems.length > 0 || !invoiceTotals
                  ? "Pending pricing"
                  : formatCurrency(invoiceTotals.outstanding)}
              </div>
              <div style={{ fontWeight: 600 }}>
                {missingPriceItems.length > 0 || !invoiceTotals
                  ? "Pending pricing"
                  : formatCurrency(invoiceTotals.oldBalance)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="section-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ marginTop: 0 }}>Saved invoices</h3>
            <p style={{ marginBottom: 0, color: "var(--color-muted)" }}>
              Track outstanding invoices and mark them as paid once settled.
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={refreshInvoices}
            disabled={invoicesQuery.isFetching}
          >
            {invoicesQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {invoicesQuery.isLoading ? (
          <p>Loading invoices…</p>
        ) : invoiceListError ? (
          <p className="error-text">
            {invoiceListError?.message ?? "Failed to load invoices"}
          </p>
        ) : invoices.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No invoices saved yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Receipts</th>
                  <th>Job site</th>
                  <th>Issued</th>
                  <th>Total</th>
                  <th>Outstanding</th>
                  <th>Old balance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const label = invoice.invoiceNo ?? `#${invoice.id}`;
                  const totalWithVat =
                    invoice.invoice.totalWithVat ?? invoice.invoice.subtotal;
                  const outstandingAmount = Math.max(
                    0,
                    invoice.invoice.outstanding ??
                      totalWithVat - (invoice.invoice.amountPaid ?? 0),
                  );
                  const isMarking =
                    markInvoicePaidMutation.isPending && markingInvoiceId === invoice.id;
                  return (
                    <tr key={invoice.id}>
                      <td>{label}</td>
                      <td>{invoice.customer.name}</td>
                      <td>{invoice.invoice.receiptType ?? "NORMAL"}</td>
                      <td>{invoice.invoice.receiptCount}</td>
                      <td>{invoice.jobSite?.name ?? "—"}</td>
                      <td>{new Date(invoice.issuedAt).toLocaleDateString()}</td>
                      <td>{formatCurrency(totalWithVat)}</td>
                      <td>{formatCurrency(outstandingAmount)}</td>
                      <td>{formatCurrency(invoice.invoice.oldBalance ?? 0)}</td>
                      <td>{invoice.status}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => navigate(`/invoices/print?invoiceId=${invoice.id}`)}
                          >
                            Print
                          </button>
                          {invoice.status !== "PAID" ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleMarkInvoicePaid(invoice)}
                              disabled={isMarking}
                            >
                              {isMarking ? "Marking…" : "Mark paid"}
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleDeleteInvoice(invoice)}
                              disabled={
                                deleteInvoiceMutation.isPending &&
                                deletingInvoiceId === invoice.id
                              }
                            >
                              {deleteInvoiceMutation.isPending && deletingInvoiceId === invoice.id
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default InvoicesPage;
