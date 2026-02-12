import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchUsers, createUser, updateUser } from "../api/users";
import { fetchDisplaySettings, updateDisplaySettings } from "../api/displaySettings";
import { fetchCustomers } from "../api/customers";
import { fetchSuppliers } from "../api/suppliers";
import { mergeCustomers, mergeSuppliers, pairCustomerSupplier } from "../api/merge";
import type { UserRole } from "../types";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS } from "../constants/permissions";

const defaultForm = {
  name: "",
  email: "",
  password: "",
  role: "MANAGER" as UserRole,
};

export default function AdminUsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [mergeForm, setMergeForm] = useState({
    customerSource: "",
    customerTarget: "",
    supplierSource: "",
    supplierTarget: "",
    pairCustomer: "",
    pairSupplier: "",
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchUsers,
    enabled: user?.role === "ADMIN",
  });
  const displaySettingsQuery = useQuery({
    queryKey: ["display-settings"],
    queryFn: fetchDisplaySettings,
    enabled: user?.role === "ADMIN",
  });
  const customersQuery = useQuery({
    queryKey: ["merge-customers-list"],
    queryFn: fetchCustomers,
    enabled: user?.role === "ADMIN",
  });
  const suppliersQuery = useQuery({
    queryKey: ["merge-suppliers-list"],
    queryFn: fetchSuppliers,
    enabled: user?.role === "ADMIN",
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setForm(defaultForm);
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create user");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => updateUser(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update user");
    },
  });

  const updateDisplayMutation = useMutation({
    mutationFn: updateDisplaySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["display-settings"] });
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
      setDisplayError(null);
    },
    onError: (err: any) => setDisplayError(err?.response?.data?.error ?? err?.message ?? "Failed to update settings"),
  });

  const mergeCustomersMutation = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      mergeCustomers(sourceId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merge-customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
      setMergeError(null);
      setMergeSuccess("Customers merged successfully.");
    },
    onError: (err: any) => {
      setMergeSuccess(null);
      setMergeError(err?.response?.data?.error ?? err?.message ?? "Failed to merge customers");
    },
  });

  const mergeSuppliersMutation = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: number; targetId: number }) =>
      mergeSuppliers(sourceId, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merge-suppliers-list"] });
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
      setMergeError(null);
      setMergeSuccess("Suppliers merged successfully.");
    },
    onError: (err: any) => {
      setMergeSuccess(null);
      setMergeError(err?.response?.data?.error ?? err?.message ?? "Failed to merge suppliers");
    },
  });

  const pairMutation = useMutation({
    mutationFn: ({ customerId, supplierId }: { customerId: number; supplierId: number }) =>
      pairCustomerSupplier(customerId, supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merge-customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["merge-suppliers-list"] });
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
      setMergeError(null);
      setMergeSuccess("Customer and supplier paired.");
    },
    onError: (err: any) => {
      setMergeSuccess(null);
      setMergeError(err?.response?.data?.error ?? err?.message ?? "Failed to pair customer and supplier");
    },
  });

  if (user?.role !== "ADMIN") {
    return (
      <section style={{ padding: 32 }}>
        <h2>Manage users</h2>
        <p>You need administrator permissions to view or edit user accounts.</p>
      </section>
    );
  }

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h2>Manage users</h2>
        <p>Invite new accounts or review existing access.</p>
      </header>

      <div className="section-card" style={{ marginBottom: 32 }}>
        <h3 style={{ marginTop: 0 }}>Invite a new user</h3>
        <form
          className="form-grid two-columns"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <label>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, role: event.target.value as UserRole }))
              }
            >
              <option value="ADMIN">Admin</option>
              <option value="MANAGER">Manager</option>
              <option value="WORKER">Worker</option>
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Email *
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="user@example.com"
              required
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Temporary password *
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Generate a strong password"
              required
            />
          </label>
          {formError ? (
            <p className="error-text" style={{ gridColumn: "1 / -1" }}>
              {formError}
            </p>
          ) : null}
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="primary-button" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Existing users</h3>
        {usersQuery.isLoading ? (
          <p>Loading accounts…</p>
        ) : usersQuery.error ? (
          <p className="error-text">Failed to load users.</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {usersQuery.data?.map((account) => (
              <div key={account.id} className="section-card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                  <div>
                    <strong>{account.email}</strong>
                    <p style={{ margin: 0, color: "var(--color-muted)" }}>{account.name ?? "No name"}</p>
                  </div>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span>Role</span>
                    <select
                      value={account.role}
                      onChange={(event) =>
                        updateMutation.mutate({ id: account.id, payload: { role: event.target.value as UserRole } })
                      }
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MANAGER">Manager</option>
                      <option value="WORKER">Worker</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid three-columns" style={{ marginTop: 16 }}>
                  {PERMISSIONS.map((perm) => (
                    <label key={`${account.id}-${perm.key}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={account.permissions[perm.key]}
                        onChange={(event) =>
                          updateMutation.mutate({
                            id: account.id,
                            payload: {
                              permissions: {
                                ...account.permissions,
                                [perm.key]: event.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
                <small style={{ color: "var(--color-muted)" }}>
                  Updated {new Date(account.updatedAt).toLocaleString()}
                </small>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-card" style={{ marginTop: 32 }}>
        <h3 style={{ marginTop: 0 }}>Finance display toggles</h3>
        {displaySettingsQuery.isLoading ? (
          <p>Loading…</p>
        ) : displaySettingsQuery.error ? (
          <p className="error-text">Failed to load display settings.</p>
        ) : (
          <>
            <p style={{ marginTop: -8 }}>
              Choose which categories appear in cash/credit/debit views across the system. These toggles affect
              totals and tables (e.g., Finance page).
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.displayCash ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ displayCash: e.target.checked })}
                />
                Show cash on hand
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.displayReceivables ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ displayReceivables: e.target.checked })}
                />
                Show money owed to us
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.displayPayables ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ displayPayables: e.target.checked })}
                />
                Show money we owe
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeReceipts ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeReceipts: e.target.checked })}
                />
                Include receipts / customer payments
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeSupplierPurchases ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeSupplierPurchases: e.target.checked })}
                />
                Include supplier purchases / inventory buys
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeManufacturing ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeManufacturing: e.target.checked })}
                />
                Include manufacturing labor
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includePayroll ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includePayroll: e.target.checked })}
                />
                Include payroll
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeDebris ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeDebris: e.target.checked })}
                />
                Include debris removal
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeGeneralExpenses ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeGeneralExpenses: e.target.checked })}
                />
                Include general expenses / owner draw
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={displaySettingsQuery.data?.includeInventoryValue ?? true}
                  onChange={(e) => updateDisplayMutation.mutate({ includeInventoryValue: e.target.checked })}
                />
                Include inventory value in totals
              </label>
            </div>
            {displayError ? <p className="error-text" style={{ marginTop: 8 }}>{displayError}</p> : null}
            <small style={{ color: "var(--color-muted)" }}>
              Updated {displaySettingsQuery.data?.updatedAt ? new Date(displaySettingsQuery.data.updatedAt).toLocaleString() : "recently"}
            </small>
          </>
        )}
      </div>

      <div className="section-card" style={{ marginTop: 32 }}>
        <h3 style={{ marginTop: 0 }}>Merge / pair accounts</h3>
        <p style={{ marginTop: -8 }}>
          Combine duplicate customer or supplier accounts, or pair a customer with a supplier to treat their balance as one.
          These actions are irreversible. Merging moves all receipts/purchases/payments to the target account.
        </p>
        {mergeError ? <p className="error-text">{mergeError}</p> : null}
        {mergeSuccess ? <p className="success-text">{mergeSuccess}</p> : null}

        <div className="form-grid two-columns" style={{ marginTop: 16 }}>
          <fieldset style={{ border: "1px solid var(--color-border)", padding: 12, borderRadius: 8 }}>
            <legend>Merge customers</legend>
            <label>
              From (source)
              <select
                value={mergeForm.customerSource}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, customerSource: event.target.value }))}
              >
                <option value="">Select customer</option>
                {customersQuery.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (#{c.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Into (target)
              <select
                value={mergeForm.customerTarget}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, customerTarget: event.target.value }))}
              >
                <option value="">Select customer</option>
                {customersQuery.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (#{c.id})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={
                mergeCustomersMutation.isPending ||
                !mergeForm.customerSource ||
                !mergeForm.customerTarget ||
                mergeForm.customerSource === mergeForm.customerTarget
              }
              onClick={() =>
                mergeCustomersMutation.mutate({
                  sourceId: Number(mergeForm.customerSource),
                  targetId: Number(mergeForm.customerTarget),
                })
              }
            >
              {mergeCustomersMutation.isPending ? "Merging…" : "Merge customers"}
            </button>
          </fieldset>

          <fieldset style={{ border: "1px solid var(--color-border)", padding: 12, borderRadius: 8 }}>
            <legend>Merge suppliers</legend>
            <label>
              From (source)
              <select
                value={mergeForm.supplierSource}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, supplierSource: event.target.value }))}
              >
                <option value="">Select supplier</option>
                {suppliersQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (#{s.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Into (target)
              <select
                value={mergeForm.supplierTarget}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, supplierTarget: event.target.value }))}
              >
                <option value="">Select supplier</option>
                {suppliersQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (#{s.id})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={
                mergeSuppliersMutation.isPending ||
                !mergeForm.supplierSource ||
                !mergeForm.supplierTarget ||
                mergeForm.supplierSource === mergeForm.supplierTarget
              }
              onClick={() =>
                mergeSuppliersMutation.mutate({
                  sourceId: Number(mergeForm.supplierSource),
                  targetId: Number(mergeForm.supplierTarget),
                })
              }
            >
              {mergeSuppliersMutation.isPending ? "Merging…" : "Merge suppliers"}
            </button>
          </fieldset>
        </div>

        <fieldset style={{ border: "1px solid var(--color-border)", padding: 12, borderRadius: 8, marginTop: 16 }}>
          <legend>Pair customer with supplier (shared balance)</legend>
          <div className="form-grid two-columns">
            <label>
              Customer
              <select
                value={mergeForm.pairCustomer}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, pairCustomer: event.target.value }))}
              >
                <option value="">Select customer</option>
                {customersQuery.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (#{c.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Supplier
              <select
                value={mergeForm.pairSupplier}
                onChange={(event) => setMergeForm((prev) => ({ ...prev, pairSupplier: event.target.value }))}
              >
                <option value="">Select supplier</option>
                {suppliersQuery.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (#{s.id})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={!mergeForm.pairCustomer || !mergeForm.pairSupplier || pairMutation.isPending}
            onClick={() =>
              pairMutation.mutate({
                customerId: Number(mergeForm.pairCustomer),
                supplierId: Number(mergeForm.pairSupplier),
              })
            }
          >
            {pairMutation.isPending ? "Pairing…" : "Pair customer & supplier"}
          </button>
        </fieldset>
      </div>
    </section>
  );
}
