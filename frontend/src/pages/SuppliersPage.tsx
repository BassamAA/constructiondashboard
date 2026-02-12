import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createSupplier,
  deleteSupplier,
  fetchSuppliers,
  updateSupplier,
  overrideSupplierBalance,
} from "../api/suppliers";
import { useAuth } from "../context/AuthContext";
import type { Supplier } from "../types";

type FormState = {
  name: string;
  contact: string;
  notes: string;
};

const initialForm: FormState = {
  name: "",
  contact: "",
  notes: "",
};

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [formState, setFormState] = useState<FormState>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [balanceDrafts, setBalanceDrafts] = useState<Record<number, string>>({});
  const [balanceNotes, setBalanceNotes] = useState<Record<number, string>>({});
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceSavingId, setBalanceSavingId] = useState<number | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create supplier");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateSupplier>[1] }) =>
      updateSupplier(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update supplier");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      if (editingSupplierId !== null) {
        resetForm();
      }
    },
  });

  const overrideBalanceMutation = useMutation({
    mutationFn: ({
      id,
      amount,
      note,
    }: {
      id: number;
      amount: number | null;
      note?: string;
    }) => overrideSupplierBalance(id, { amount, note }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setBalanceError(null);
      if (variables) {
        setBalanceDrafts((prev) => {
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
        setBalanceNotes((prev) => {
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
      }
    },
    onError: (err: any) => {
      setBalanceError(err?.response?.data?.error ?? err?.message ?? "Failed to update balance");
    },
    onSettled: () => {
      setBalanceSavingId(null);
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isBusy = useMemo(
    () => isLoading || deleteMutation.isPending,
    [isLoading, deleteMutation.isPending],
  );

  function resetForm() {
    setFormState(initialForm);
    setEditingSupplierId(null);
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const name = formState.name.trim();
    if (!name) {
      setFormError("Supplier name is required");
      return;
    }

    const payload = {
      name,
      contact: formState.contact.trim() || undefined,
      notes: formState.notes.trim() || undefined,
    };

    if (editingSupplierId === null) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: editingSupplierId, data: payload });
    }
  }

  function startEditing(supplierId: number) {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return;

    setFormState({
      name: supplier.name,
      contact: supplier.contact ?? "",
      notes: supplier.notes ?? "",
    });
    setEditingSupplierId(supplierId);
    setFormError(null);
  }

  function handleBalanceInputChange(supplierId: number, value: string) {
    setBalanceDrafts((prev) => ({ ...prev, [supplierId]: value }));
  }

  function handleBalanceNoteChange(supplierId: number, value: string) {
    setBalanceNotes((prev) => ({ ...prev, [supplierId]: value }));
  }

  function handleSaveBalance(supplier: Supplier) {
    setBalanceError(null);
    const rawAmount = (balanceDrafts[supplier.id] ?? "").trim();
    if (rawAmount.length === 0) {
      setBalanceError("Enter an amount before saving the manual balance.");
      return;
    }
    const parsedAmount = Number(rawAmount);
    if (Number.isNaN(parsedAmount)) {
      setBalanceError("Enter a valid number for the manual balance.");
      return;
    }
    const noteValue = balanceNotes[supplier.id] ?? supplier.manualBalanceNote ?? "";
    setBalanceSavingId(supplier.id);
    overrideBalanceMutation.mutate({
      id: supplier.id,
      amount: parsedAmount,
      note: noteValue.trim() || undefined,
    });
  }

  function handleClearBalance(supplierId: number) {
    setBalanceError(null);
    setBalanceSavingId(supplierId);
    overrideBalanceMutation.mutate({ id: supplierId, amount: null });
  }

  return (
    <section>
      <header>
        <h2>Suppliers</h2>
        <p>Keep supplier contacts handy for purchase and production records.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{editingSupplierId ? "Edit supplier" : "Add supplier"}</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Supplier name *
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Rock Quarry LLC"
              required
            />
          </label>
          <label>
            Contact info
            <input
              value={formState.contact}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, contact: event.target.value }))
              }
              placeholder="Maria – +1 (555) 444-1234"
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Payment terms, delivery preferences, etc."
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingSupplierId === null
                  ? "Save supplier"
                  : "Update supplier"}
            </button>
            {editingSupplierId !== null && (
              <button type="button" className="secondary-button" onClick={resetForm}>
                Cancel editing
              </button>
            )}
          </div>
          {formError && (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Supplier list</h3>
        {isAdmin && balanceError ? (
          <p className="error-text" style={{ marginTop: -4 }}>
            {balanceError}
          </p>
        ) : null}
        {isBusy ? (
          <p>Loading suppliers…</p>
        ) : suppliers.length === 0 ? (
          <p>No suppliers stored yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Notes</th>
                {isAdmin ? <th style={{ minWidth: 260 }}>Manual override</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{supplier.contact ?? "—"}</td>
                  <td>{supplier.notes ?? "—"}</td>
                  {isAdmin ? (
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          type="number"
                          step="any"
                          value={balanceDrafts[supplier.id] ?? ""}
                          placeholder={
                            supplier.manualBalanceOverride !== null &&
                            supplier.manualBalanceOverride !== undefined
                              ? supplier.manualBalanceOverride.toString()
                              : (supplier.computedBalance ?? 0).toString()
                          }
                          onChange={(event) => handleBalanceInputChange(supplier.id, event.target.value)}
                        />
                        <input
                          type="text"
                          value={
                            balanceNotes[supplier.id] ?? supplier.manualBalanceNote ?? ""
                          }
                          placeholder="Optional note"
                          onChange={(event) => handleBalanceNoteChange(supplier.id, event.target.value)}
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => handleSaveBalance(supplier)}
                            disabled={
                              balanceSavingId === supplier.id && overrideBalanceMutation.isPending
                            }
                          >
                            {balanceSavingId === supplier.id && overrideBalanceMutation.isPending
                              ? "Saving…"
                              : "Save"}
                          </button>
                          {supplier.manualBalanceOverride !== null ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleClearBalance(supplier.id)}
                              disabled={
                                balanceSavingId === supplier.id && overrideBalanceMutation.isPending
                              }
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                        <small style={{ color: "var(--color-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                          {(() => {
                            const systemBalance = supplier.computedBalance ?? 0;
                            const hasOverride =
                              supplier.manualBalanceOverride !== null &&
                              supplier.manualBalanceOverride !== undefined;
                            const effectiveBalance = hasOverride
                              ? Number(supplier.manualBalanceOverride)
                              : systemBalance;
                            return (
                              <>
                                <span>
                                  Current value: {formatCurrency(effectiveBalance)}{" "}
                                  {hasOverride ? "(manual override)" : "(system)"}
                                </span>
                                <span>System balance: {formatCurrency(systemBalance)}</span>
                              </>
                            );
                          })()}
                          {supplier.manualBalanceUpdatedAt
                            ? `Updated ${new Date(supplier.manualBalanceUpdatedAt).toLocaleString()}${
                                supplier.manualBalanceUpdatedBy
                                  ? ` by ${
                                      supplier.manualBalanceUpdatedBy.name ??
                                      supplier.manualBalanceUpdatedBy.email
                                    }`
                                  : ""
                              }`
                            : null}
                          {supplier.manualBalanceNote ? `Note: ${supplier.manualBalanceNote}` : null}
                        </small>
                      </div>
                    </td>
                  ) : null}
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => startEditing(supplier.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => deleteMutation.mutate(supplier.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default SuppliersPage;
