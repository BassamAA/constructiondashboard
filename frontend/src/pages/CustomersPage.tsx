import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createCustomer,
  deleteCustomer,
  fetchCustomers,
  updateCustomer,
  overrideCustomerBalance,
} from "../api/customers";
import { useAuth } from "../context/AuthContext";
import type { Customer } from "../types";

type FormState = {
  name: string;
  receiptType: "NORMAL" | "TVA";
  contactName: string;
  phone: string;
  email: string;
  notes: string;
};

const initialForm: FormState = {
  name: "",
  receiptType: "NORMAL",
  contactName: "",
  phone: "",
  email: "",
  notes: "",
};

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function CustomersPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [formState, setFormState] = useState<FormState>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [balanceDrafts, setBalanceDrafts] = useState<Record<number, string>>({});
  const [balanceNotes, setBalanceNotes] = useState<Record<number, string>>({});
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceSavingId, setBalanceSavingId] = useState<number | null>(null);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const createMutation = useMutation({
    mutationFn: createCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create customer");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateCustomer>[1] }) =>
      updateCustomer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update customer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (editingCustomerId !== null) {
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
    }) => overrideCustomerBalance(id, { amount, note }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
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
    setEditingCustomerId(null);
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const name = formState.name.trim();
    if (!name) {
      setFormError("Customer name is required");
      return;
    }

    const payload = {
      name,
      receiptType: formState.receiptType,
      contactName: formState.contactName.trim() || undefined,
      phone: formState.phone.trim() || undefined,
      email: formState.email.trim() || undefined,
      notes: formState.notes.trim() || undefined,
    };

    if (editingCustomerId === null) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: editingCustomerId, data: payload });
    }
  }

  function startEditing(customerId: number) {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;

    setFormState({
      name: customer.name,
      receiptType: customer.receiptType,
      contactName: customer.contactName ?? "",
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      notes: customer.notes ?? "",
    });
    setEditingCustomerId(customerId);
    setFormError(null);
  }

  function handleBalanceInputChange(customerId: number, value: string) {
    setBalanceDrafts((prev) => ({ ...prev, [customerId]: value }));
  }

  function handleBalanceNoteChange(customerId: number, value: string) {
    setBalanceNotes((prev) => ({ ...prev, [customerId]: value }));
  }

  function handleSaveBalance(customer: Customer) {
    setBalanceError(null);
    const rawAmount = (balanceDrafts[customer.id] ?? "").trim();
    if (rawAmount.length === 0) {
      setBalanceError("Enter an amount before saving the manual balance.");
      return;
    }
    const parsedAmount = Number(rawAmount);
    if (Number.isNaN(parsedAmount)) {
      setBalanceError("Enter a valid number for the manual balance.");
      return;
    }
    const noteValue =
      balanceNotes[customer.id] ?? customer.manualBalanceNote ?? "";
    setBalanceSavingId(customer.id);
    overrideBalanceMutation.mutate({
      id: customer.id,
      amount: parsedAmount,
      note: noteValue.trim() || undefined,
    });
  }

  function handleClearBalance(customerId: number) {
    setBalanceError(null);
    setBalanceSavingId(customerId);
    overrideBalanceMutation.mutate({ id: customerId, amount: null });
  }

  return (
    <section>
      <header>
        <h2>Customers</h2>
        <p>Create and manage customer accounts.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{editingCustomerId ? "Edit customer" : "Add customer"}</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Customer name *
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Acme Construction"
              required
            />
          </label>
          <label>
            Receipt type *
            <select
              value={formState.receiptType}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  receiptType: event.target.value as "NORMAL" | "TVA",
                }))
              }
            >
              <option value="NORMAL">Normal</option>
              <option value="TVA">T (TVA)</option>
            </select>
            <small className="muted-text">Determines whether this customer’s receipts use normal or T-prefixed numbers.</small>
          </label>
          <label>
            Contact person
            <input
              value={formState.contactName}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, contactName: event.target.value }))
              }
              placeholder="Jane Doe"
            />
          </label>
          <label>
            Phone
            <input
              value={formState.phone}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, phone: event.target.value }))
              }
              placeholder="+1 (555) 123-4567"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={formState.email}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, email: event.target.value }))
              }
              placeholder="billing@acme.com"
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Any special billing instructions"
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingCustomerId === null
                  ? "Save customer"
                  : "Update customer"}
            </button>
            {editingCustomerId !== null && (
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
        <h3 style={{ marginTop: 0 }}>Customer list</h3>
        {isAdmin && balanceError ? (
          <p className="error-text" style={{ marginTop: -4 }}>
            {balanceError}
          </p>
        ) : null}
        {isBusy ? (
          <p>Loading customers…</p>
        ) : customers.length === 0 ? (
          <p>No customers yet. Add your first above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Receipt type</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Notes</th>
                {isAdmin ? <th style={{ minWidth: 260 }}>Manual override</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>
                    <span className="badge">{customer.receiptType === "TVA" ? "T (TVA)" : "Normal"}</span>
                  </td>
                  <td>{customer.contactName ?? "—"}</td>
                  <td>{customer.phone ?? "—"}</td>
                  <td>{customer.email ?? "—"}</td>
                  <td>{customer.notes ?? "—"}</td>
                  {isAdmin ? (
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input
                          type="number"
                          step="any"
                          value={balanceDrafts[customer.id] ?? ""}
                          placeholder={
                            customer.manualBalanceOverride !== null &&
                            customer.manualBalanceOverride !== undefined
                              ? customer.manualBalanceOverride.toString()
                              : (customer.computedBalance ?? 0).toString()
                          }
                          onChange={(event) => handleBalanceInputChange(customer.id, event.target.value)}
                        />
                        <input
                          type="text"
                          value={
                            balanceNotes[customer.id] ?? customer.manualBalanceNote ?? ""
                          }
                          placeholder="Optional note"
                          onChange={(event) => handleBalanceNoteChange(customer.id, event.target.value)}
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => handleSaveBalance(customer)}
                            disabled={
                              balanceSavingId === customer.id && overrideBalanceMutation.isPending
                            }
                          >
                            {balanceSavingId === customer.id && overrideBalanceMutation.isPending
                              ? "Saving…"
                              : "Save"}
                          </button>
                          {customer.manualBalanceOverride !== null ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleClearBalance(customer.id)}
                              disabled={
                                balanceSavingId === customer.id && overrideBalanceMutation.isPending
                              }
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                        <small style={{ color: "var(--color-muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                          {(() => {
                            const systemBalance = customer.computedBalance ?? 0;
                            const hasOverride =
                              customer.manualBalanceOverride !== null &&
                              customer.manualBalanceOverride !== undefined;
                            const effectiveBalance = hasOverride
                              ? Number(customer.manualBalanceOverride)
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
                          {customer.manualBalanceUpdatedAt
                            ? `Updated ${new Date(customer.manualBalanceUpdatedAt).toLocaleString()}${
                                customer.manualBalanceUpdatedBy
                                  ? ` by ${
                                      customer.manualBalanceUpdatedBy.name ??
                                      customer.manualBalanceUpdatedBy.email
                                    }`
                                  : ""
                              }`
                            : null}
                          {customer.manualBalanceNote ? `Note: ${customer.manualBalanceNote}` : null}
                        </small>
                      </div>
                    </td>
                  ) : null}
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => startEditing(customer.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => deleteMutation.mutate(customer.id)}
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

export default CustomersPage;
