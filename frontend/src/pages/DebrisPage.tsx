import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchSuppliers } from "../api/suppliers";
import { fetchProducts } from "../api/products";
import {
  createDebrisRemoval,
  fetchDebris,
  markDebrisRemovalPaid,
  markDebrisRemovalUnpaid,
  updateDebrisRemoval,
  deleteDebrisRemoval,
} from "../api/debris";
import type { DebrisEntry, Supplier } from "../types";
import { useAuth } from "../context/AuthContext";

const debrisProductName = "debris";

type RemovalFormState = {
  date: string;
  supplierId: string;
  volume: string;
  amount: string;
  notes: string;
};

const defaultForm: RemovalFormState = {
  date: "",
  supplierId: "",
  volume: "",
  amount: "",
  notes: "",
};

export function DebrisPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canEditDebris = can("debris:edit");
  const [formState, setFormState] = useState<RemovalFormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedPending, setSelectedPending] = useState<DebrisEntry | null>(null);
  const [markForm, setMarkForm] = useState<{ amount: string; date: string; supplierId: string }>({
    amount: "",
    date: "",
    supplierId: "",
  });
  const [markError, setMarkError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<DebrisEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [markUnpaidError, setMarkUnpaidError] = useState<string | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const debrisQuery = useQuery({
    queryKey: ["debris", "paid"],
    queryFn: () => fetchDebris({ paid: true }),
  });

  const pendingQuery = useQuery({
    queryKey: ["debris", "pending"],
    queryFn: () => fetchDebris({ paid: false }),
  });

  const createMutation = useMutation({
    mutationFn: createDebrisRemoval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debris"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "paid"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      resetForm();
      setSuccessMessage("Removal logged.");
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to log debris entry");
      setSuccessMessage(null);
    },
  });
  const debrisEntries = debrisQuery.data ?? [];
  const pendingEntries = pendingQuery.data ?? [];
  const markPaidMutation = useMutation({
    mutationFn: ({
      entryId,
      amount,
      date,
      supplierId,
    }: {
      entryId: number;
      amount?: number;
      date?: string;
      supplierId: number;
    }) => markDebrisRemovalPaid(entryId, { amount, date, supplierId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debris", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "paid"] });
      setSelectedPending(null);
      setMarkForm({ amount: "", date: "", supplierId: "" });
      setMarkError(null);
    },
    onError: (err: any) => {
      setMarkError(err?.response?.data?.error ?? err?.message ?? "Failed to mark removal as paid");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        date?: string;
        supplierId?: number | null;
        volume?: number;
        amount?: number | null;
        notes?: string | null;
      };
    }) => updateDebrisRemoval(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debris"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "paid"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setSuccessMessage("Removal updated.");
      setFormState(defaultForm);
      setEditingEntry(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update removal");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: number) => deleteDebrisRemoval(entryId),
    onSuccess: (_, entryId) => {
      queryClient.invalidateQueries({ queryKey: ["debris"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "paid"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (editingEntry?.id === entryId) {
        setFormState(defaultForm);
        setEditingEntry(null);
      }
      if (selectedPending?.id === entryId) {
        setSelectedPending(null);
        setMarkForm({ amount: "", date: "", supplierId: "" });
        setMarkError(null);
      }
      setDeleteError(null);
      setSuccessMessage("Removal deleted.");
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.error ?? err?.message ?? "Failed to delete removal");
    },
  });

  const markUnpaidMutation = useMutation({
    mutationFn: (entryId: number) => markDebrisRemovalUnpaid(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debris", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["debris", "paid"] });
      setMarkUnpaidError(null);
    },
    onError: (err: any) => {
      setMarkUnpaidError(
        err?.response?.data?.error ?? err?.message ?? "Failed to mark removal as unpaid",
      );
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const debrisProduct = useMemo(() => {
    return products.find(
      (product) => product.name.trim().toLowerCase() === debrisProductName,
    );
  }, [products]);

  const availableVolume = debrisProduct?.stockQty ?? 0;
  const isEditing = Boolean(editingEntry);
  const isDeletingRemoval = deleteMutation.isPending;

  function resetForm() {
    setFormState(defaultForm);
    setFormError(null);
    setSuccessMessage(null);
    setSelectedPending(null);
    setMarkForm({ amount: "", date: "", supplierId: "" });
    setEditingEntry(null);
  }

  function beginEdit(entry: DebrisEntry) {
    if (!canEditDebris || entry.removalPaymentId) {
      return;
    }
    setEditingEntry(entry);
    setSelectedPending(null);
    setMarkForm({ amount: "", date: "", supplierId: "" });
    setFormState({
      date: entry.date ? entry.date.slice(0, 10) : "",
      supplierId: entry.supplierId ? String(entry.supplierId) : "",
      volume: entry.volume.toString(),
      amount: entry.removalCost != null ? entry.removalCost.toString() : "",
      notes: entry.notes ?? "",
    });
    setFormError(null);
    setSuccessMessage(null);
    setDeleteError(null);
  }

  function handleDeleteEntry(entry: DebrisEntry) {
    if (!canEditDebris) return;
    if (
      !window.confirm(
        "Delete this debris removal? This will restore the removed volume back into stock.",
      )
    ) {
      return;
    }
    deleteMutation.mutate(entry.id);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!debrisProduct) {
      setFormError("Add a 'Debris' product in the Products tab before recording removals.");
      return;
    }

    if (!formState.supplierId) {
      setFormError("Select the supplier who hauled the debris.");
      return;
    }
    const supplierId = Number(formState.supplierId);
    if (Number.isNaN(supplierId)) {
      setFormError("Invalid supplier selection.");
      return;
    }

    const volume = Number(formState.volume);
    if (!formState.volume || Number.isNaN(volume) || volume <= 0) {
      setFormError("Enter a valid volume in m³ to remove.");
      return;
    }

    const allowableVolume = availableVolume + (editingEntry?.volume ?? 0);

    if (availableVolume <= 0 && !isEditing) {
      setFormError("No debris in stock to remove.");
      return;
    }

    if (volume > allowableVolume + 1e-6) {
      setFormError(
        `Cannot remove ${volume} m³. Only ${allowableVolume.toFixed(3)} m³ available.`,
      );
      return;
    }

    const amount = Number(formState.amount || 0);
    if (Number.isNaN(amount) || amount < 0) {
      setFormError("Enter a valid removal cost");
      return;
    }

    const trimmedNotes =
      formState.notes && formState.notes.trim().length > 0 ? formState.notes.trim() : null;

    if (editingEntry) {
      updateMutation.mutate({
        id: editingEntry.id,
        payload: {
          date: formState.date || undefined,
          supplierId,
          volume,
          amount: formState.amount ? amount : undefined,
          notes: trimmedNotes,
        },
      });
      return;
    }

    createMutation.mutate({
      date: formState.date || undefined,
      supplierId,
      volume,
      amount: formState.amount ? amount : undefined,
      notes: trimmedNotes ?? undefined,
    });
  }

  return (
    <section>
      <header>
        <h2>Debris Management</h2>
        <p>Track debris inventory and record haul-away payments to your disposal partners.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Current debris on site</h3>
        {loadingProducts ? (
          <p>Loading inventory…</p>
        ) : !debrisProduct ? (
          <p style={{ marginBottom: 0 }}>
            No product named “Debris” found. Add one under Products to track inventory.
          </p>
        ) : (
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {availableVolume.toFixed(3)} m³ available
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Outstanding removals</h3>
        {pendingQuery.isLoading ? (
          <p>Loading outstanding removals…</p>
        ) : pendingEntries.length === 0 ? (
          <p>All debris removals have been marked as paid.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Volume (m³)</th>
                <th>Recorded cost</th>
                <th>Supplier</th>
                <th>Notes</th>
                <th>Paid</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.date).toLocaleDateString()}</td>
                  <td>{entry.volume.toFixed(3)}</td>
                  <td>{entry.removalCost ? `$${entry.removalCost.toFixed(2)}` : "—"}</td>
                  <td>{entry.supplier?.name ?? "—"}</td>
                  <td>{entry.notes ?? "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    {entry.removalPaymentId ? "✓" : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                        flexWrap: "wrap",
                      }}
                    >
                      {canEditDebris ? (
                        <>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => beginEdit(entry)}
                            disabled={isSaving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleDeleteEntry(entry)}
                            disabled={isDeletingRemoval}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setSelectedPending(entry);
                          setMarkForm({
                            amount: entry.removalCost ? entry.removalCost.toString() : "",
                            date: new Date().toISOString().slice(0, 10),
                            supplierId: entry.supplierId ? String(entry.supplierId) : "",
                          });
                          setMarkError(null);
                        }}
                        disabled={markPaidMutation.isPending && selectedPending?.id === entry.id}
                      >
                        Mark paid
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedPending ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!selectedPending) return;
              setMarkError(null);
              const supplierId =
                selectedPending.supplierId ??
                (markForm.supplierId ? Number(markForm.supplierId) : null);
              if (!supplierId || Number.isNaN(supplierId)) {
                setMarkError("Select the supplier that hauled this debris.");
                return;
              }
              const amount =
                markForm.amount && markForm.amount.trim().length > 0
                  ? Number(markForm.amount)
                  : undefined;
              if (amount !== undefined && (Number.isNaN(amount) || amount <= 0)) {
                setMarkError("Enter a valid amount to pay.");
                return;
              }
              markPaidMutation.mutate({
                entryId: selectedPending.id,
                amount,
                date: markForm.date || undefined,
                supplierId,
              });
            }}
            className="form-grid two-columns"
            style={{ marginTop: 16 }}
          >
            <label>
              Payment date
              <input
                type="date"
                value={markForm.date}
                onChange={(event) =>
                  setMarkForm((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </label>
            {selectedPending.supplierId ? (
              <div>
                <strong>Supplier:</strong>{" "}
                {selectedPending.supplier?.name ??
                  suppliers.find((supplier) => supplier.id === selectedPending.supplierId)?.name ??
                  "Unknown"}
              </div>
            ) : (
              <label>
                Supplier *
                <select
                  value={markForm.supplierId}
                  onChange={(event) =>
                    setMarkForm((prev) => ({ ...prev, supplierId: event.target.value }))
                  }
                  required
                >
                  <option value="" disabled>
                    Select supplier
                  </option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Amount {selectedPending.removalCost ? "(defaults to recorded cost)" : "*"}
              <input
                type="number"
                min="0"
                step="any"
                value={markForm.amount}
                onChange={(event) =>
                  setMarkForm((prev) => ({ ...prev, amount: event.target.value }))
                }
                placeholder={selectedPending.removalCost?.toFixed(2) ?? "0.00"}
              />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button type="submit" className="primary-button" disabled={markPaidMutation.isPending}>
                {markPaidMutation.isPending ? "Saving…" : "Confirm payment"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setSelectedPending(null);
                  setMarkForm({ amount: "", date: "", supplierId: "" });
                  setMarkError(null);
                }}
                disabled={markPaidMutation.isPending}
              >
                Cancel
              </button>
            </div>
            {markError ? (
              <div className="error-text" style={{ gridColumn: "1 / -1" }}>
                {markError}
              </div>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{isEditing ? "Edit debris removal" : "Log debris removal"}</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
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
            Removal partner (supplier) *
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
          <label>
            Volume (m³) *
            <input
              type="number"
              min="0"
              step="any"
              value={formState.volume}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, volume: event.target.value }))
              }
              placeholder="5"
              required
            />
            {formState.volume ? (
              <small>Max available: {availableVolume.toFixed(3)} m³</small>
            ) : null}
          </label>
          <label>
            Removal cost
            <input
              type="number"
              min="0"
              step="any"
              value={formState.amount}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, amount: event.target.value }))
              }
              placeholder="150.00"
            />
            <small>Leave blank to log the removal without recording payment.</small>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Any details about the removal"
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? "Saving..." : isEditing ? "Update removal" : "Log removal"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={resetForm}
              disabled={isSaving}
            >
              {isEditing ? "Cancel edit" : "Reset"}
            </button>
          </div>
          {formError && (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </div>
          )}
          {successMessage && (
            <div style={{ gridColumn: "1 / -1", color: "#1b5e20" }}>
              {successMessage}
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Removal history</h3>
        {debrisQuery.isLoading ? (
          <p>Loading removal history…</p>
        ) : debrisEntries.length === 0 ? (
          <p>No debris removals recorded yet.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Volume (m³)</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Notes</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {debrisEntries.map((entry: DebrisEntry) => {
                  const payment = entry.removalPayment;
                  const amount = payment?.amount ?? entry.removalCost ?? 0;
                  return (
                    <tr key={entry.id}>
                      <td>{new Date(entry.removalDate ?? entry.date).toLocaleDateString()}</td>
                      <td>{payment?.supplier?.name ?? "—"}</td>
                      <td>{entry.volume.toFixed(3)}</td>
                      <td>${amount.toFixed(2)}</td>
                      <td style={{ textAlign: "center" }}>
                        {entry.removalPaymentId ? "✓" : "—"}
                      </td>
                      <td>{entry.notes ?? payment?.description ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                            flexWrap: "wrap",
                          }}
                        >
                          {canEditDebris && entry.removalPaymentId ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Mark this removal as unpaid? The payment record will be removed.",
                                  )
                                ) {
                                  markUnpaidMutation.mutate(entry.id);
                                }
                              }}
                              disabled={markUnpaidMutation.isPending}
                              title="Mark unpaid"
                            >
                              {markUnpaidMutation.isPending ? "Updating…" : "Mark unpaid"}
                            </button>
                          ) : null}
                          {canEditDebris && !entry.removalPaymentId ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => beginEdit(entry)}
                              disabled={isSaving}
                            >
                              Edit
                            </button>
                          ) : null}
                          {canEditDebris ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => handleDeleteEntry(entry)}
                              disabled={isDeletingRemoval}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {markUnpaidError ? (
              <p className="error-text" style={{ marginTop: 8 }}>
                {markUnpaidError}
              </p>
            ) : null}
            {deleteError ? (
              <p className="error-text" style={{ marginTop: 4 }}>
                {deleteError}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export default DebrisPage;
