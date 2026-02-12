import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createEmployee,
  updateEmployee,
  archiveEmployee,
  fetchEmployees,
  fetchEmployeePieceRates,
  createPieceRate,
  updatePieceRate,
  deletePieceRate,
} from "../api/employees";
import { fetchProducts } from "../api/products";
import type {
  Employee,
  EmployeeRole,
  PayFrequency,
  PayrollType,
  ManufacturingPieceRate,
  Product,
} from "../types";

const employeeRoles: EmployeeRole[] = [
  "DRIVER",
  "ACCOUNTANT",
  "MANAGER",
  "MANUFACTURING",
  "OTHER",
];

const payrollTypes: PayrollType[] = ["SALARY", "PIECEWORK"];

const payFrequencies: PayFrequency[] = ["WEEKLY", "MONTHLY"];

type FormState = {
  name: string;
  role: EmployeeRole;
  payType: PayrollType;
  salaryAmount: string;
  salaryFrequency: PayFrequency;
  phone: string;
  notes: string;
  active: boolean;
};

const defaultForm: FormState = {
  name: "",
  role: "DRIVER",
  payType: "SALARY",
  salaryAmount: "",
  salaryFrequency: "WEEKLY",
  phone: "",
  notes: "",
  active: true,
};

export function EmployeesPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [managedPieceEmployee, setManagedPieceEmployee] = useState<Employee | null>(null);
  const [pieceForm, setPieceForm] = useState<{ productId: string; rate: string; helperRate: string }>({
    productId: "",
    rate: "",
    helperRate: "",
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const manufacturedProducts = useMemo(
    () => products.filter((product) => product.isManufactured),
    [products],
  );

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
  });

  const createMutation = useMutation({
    mutationFn: createEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to create employee");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateEmployee>[1] }) =>
      updateEmployee(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update employee");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: archiveEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      resetForm();
    },
  });

  const pieceRatesQuery = useQuery({
    queryKey: ["employee-piece-rates", managedPieceEmployee?.id],
    queryFn: () =>
      managedPieceEmployee ? fetchEmployeePieceRates(managedPieceEmployee.id) : Promise.resolve([]),
    enabled: managedPieceEmployee !== null,
  });

  const createPieceRateMutation = useMutation({
    mutationFn: ({
      employeeId,
      productId,
      rate,
      helperRate,
    }: {
      employeeId: number;
      productId: number;
      rate: number;
      helperRate?: number | null;
    }) => createPieceRate(employeeId, { productId, rate, helperRate }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["employee-piece-rates", managedPieceEmployee?.id],
      });
      setPieceForm({ productId: "", rate: "", helperRate: "" });
    },
  });

  const updatePieceRateMutation = useMutation({
    mutationFn: ({
      pieceRateId,
      data,
    }: {
      pieceRateId: number;
      data: Partial<{ rate: number; helperRate: number | null; isActive: boolean }>;
    }) => updatePieceRate(pieceRateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["employee-piece-rates", managedPieceEmployee?.id],
      });
    },
  });

  const deletePieceRateMutation = useMutation({
    mutationFn: deletePieceRate,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["employee-piece-rates", managedPieceEmployee?.id],
      });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isBusy = useMemo(
    () => isLoading || archiveMutation.isPending,
    [isLoading, archiveMutation.isPending],
  );

  function resetForm() {
    setFormState(defaultForm);
    setEditingEmployeeId(null);
    setFormError(null);
  }

  function populateForm(employee: Employee) {
    setFormState({
      name: employee.name,
      role: employee.role,
      payType: employee.payType,
      salaryAmount:
        employee.salaryAmount !== undefined && employee.salaryAmount !== null
          ? String(employee.salaryAmount)
          : "",
      salaryFrequency: employee.salaryFrequency ?? "WEEKLY",
      phone: employee.phone ?? "",
      notes: employee.notes ?? "",
      active: employee.active,
    });
    setEditingEmployeeId(employee.id);
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const name = formState.name.trim();
    if (!name) {
      setFormError("Employee name is required");
      return;
    }

    const payload: Parameters<typeof createEmployee>[0] = {
      name,
      role: formState.role,
      payType: formState.payType,
      phone: formState.phone.trim() || undefined,
      notes: formState.notes.trim() || undefined,
      active: formState.active,
    };

    if (formState.payType === "SALARY") {
      const salaryAmount = Number(formState.salaryAmount);
      if (!formState.salaryAmount || Number.isNaN(salaryAmount) || salaryAmount <= 0) {
        setFormError("Enter a valid salary amount");
        return;
      }
      payload.salaryAmount = salaryAmount;
      payload.salaryFrequency = formState.salaryFrequency;
    } else {
      payload.salaryAmount = undefined;
      payload.salaryFrequency = undefined;
    }

    if (editingEmployeeId === null) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate({ id: editingEmployeeId, data: payload });
    }
  }

  function handleManagePieceRates(employee: Employee) {
    setManagedPieceEmployee(employee);
    setPieceForm({ productId: "", rate: "", helperRate: "" });
  }

  function handleAddPieceRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managedPieceEmployee) return;
    if (!pieceForm.productId) {
      window.alert("Select a product");
      return;
    }
    const productId = Number(pieceForm.productId);
    if (Number.isNaN(productId) || productId <= 0) {
      window.alert("Select a product");
      return;
    }
    const rateValue = Number(pieceForm.rate);
    if (!pieceForm.rate || Number.isNaN(rateValue) || rateValue <= 0) {
      window.alert("Enter a valid rate");
      return;
    }
    const helperRateValue =
      pieceForm.helperRate && pieceForm.helperRate.trim().length > 0
        ? Number(pieceForm.helperRate)
        : null;
    if (
      helperRateValue !== null &&
      (Number.isNaN(helperRateValue) || helperRateValue <= 0)
    ) {
      window.alert("Enter a valid helper rate or leave blank");
      return;
    }
    createPieceRateMutation.mutate({
      employeeId: managedPieceEmployee.id,
      productId,
      rate: rateValue,
      helperRate: helperRateValue ?? undefined,
    });
  }

  function handleTogglePieceRate(rate: ManufacturingPieceRate) {
    updatePieceRateMutation.mutate({
      pieceRateId: rate.id,
      data: { isActive: !rate.isActive },
    });
  }

  function handleEditPieceRate(rate: ManufacturingPieceRate) {
    const newRateInput = window.prompt("Piece rate", rate.rate.toString());
    if (newRateInput === null) return;
    const parsed = Number(newRateInput);
    if (Number.isNaN(parsed) || parsed <= 0) {
      window.alert("Enter a valid rate.");
      return;
    }
    const helperPrompt = window.prompt(
      "Helper rate (leave empty to clear)",
      rate.helperRate != null ? rate.helperRate.toString() : "",
    );
    if (helperPrompt === null) return;
    const trimmed = helperPrompt.trim();
    const helperParsed = trimmed.length === 0 ? null : Number(trimmed);
    if (helperParsed !== null && (Number.isNaN(helperParsed) || helperParsed <= 0)) {
      window.alert("Enter a valid helper rate.");
      return;
    }
    updatePieceRateMutation.mutate({
      pieceRateId: rate.id,
      data: { rate: parsed, helperRate: helperParsed },
    });
  }

  function handleDeletePieceRate(rate: ManufacturingPieceRate) {
    const pieceName = rate.product?.name ?? "this product";
    const confirmed = window.confirm(`Delete piece rate for ${pieceName}?`);
    if (!confirmed) return;
    deletePieceRateMutation.mutate(rate.id);
  }

  return (
    <section>
      <header>
        <h2>Employees</h2>
        <p>Manage drivers, office staff, and manufacturing workers.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>{editingEmployeeId ? "Edit employee" : "Add employee"}</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Name *
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="John Doe"
              required
            />
          </label>
          <label>
            Role *
            <select
              value={formState.role}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, role: event.target.value as EmployeeRole }))
              }
            >
              {employeeRoles.map((role) => (
                <option key={role} value={role}>
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pay type *
            <select
              value={formState.payType}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  payType: event.target.value as PayrollType,
                }))
              }
            >
              {payrollTypes.map((type) => (
                <option key={type} value={type}>
                  {type === "SALARY" ? "Salary" : "Piecework"}
                </option>
              ))}
            </select>
          </label>

          {formState.payType === "SALARY" ? (
            <>
              <label>
                Salary amount *
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formState.salaryAmount}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, salaryAmount: event.target.value }))
                  }
                  placeholder="500"
                />
              </label>
              <label>
                Salary frequency *
                <select
                  value={formState.salaryFrequency}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      salaryFrequency: event.target.value as PayFrequency,
                    }))
                  }
                >
                  {payFrequencies.map((freq) => (
                    <option key={freq} value={freq}>
                      {freq === "WEEKLY" ? "Weekly" : "Monthly"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div style={{ gridColumn: "1 / -1", background: "#f8fafc", padding: 12, borderRadius: 8 }}>
              <strong>Piecework rates</strong>
              <p style={{ margin: "4px 0 0", color: "var(--color-muted)" }}>
                Manufacturing workers now use per-product rates. Configure them in the Piece rates panel below.
              </p>
            </div>
          )}

          <label>
            Phone
            <input
              value={formState.phone}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, phone: event.target.value }))
              }
              placeholder="+1 (555) 000-0000"
            />
          </label>
          <label>
            Active
            <input
              type="checkbox"
              checked={formState.active}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, active: event.target.checked }))
              }
              style={{ marginTop: 8 }}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
              placeholder="Any extra information"
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving
                ? "Saving..."
                : editingEmployeeId === null
                  ? "Save employee"
                  : "Update employee"}
            </button>
            {editingEmployeeId !== null && (
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
        <h3 style={{ marginTop: 0 }}>Employees</h3>
        {isBusy ? (
          <p>Loading employees…</p>
        ) : employees.length === 0 ? (
          <p>No employees recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Pay type</th>
                <th>Compensation</th>
                <th>Status</th>
                <th>Phone</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.name}</td>
                  <td>{employee.role}</td>
                  <td>{employee.payType === "SALARY" ? "Salary" : "Piecework"}</td>
                  <td>
                    {employee.payType === "SALARY"
                      ? employee.salaryAmount !== null && employee.salaryAmount !== undefined
                        ? `$${employee.salaryAmount.toFixed(2)} / ${
                            employee.salaryFrequency === "MONTHLY" ? "month" : "week"
                          }`
                        : "—"
                      : employee.role === "MANUFACTURING"
                        ? "See piece rates"
                        : "Piecework"}
                  </td>
                  <td>{employee.active ? "Active" : "Archived"}</td>
                  <td>{employee.phone ?? "—"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => populateForm(employee)}
                      >
                        Edit
                      </button>
                      {employee.role === "MANUFACTURING" && employee.payType === "PIECEWORK" ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleManagePieceRates(employee)}
                        >
                          Piece rates
                        </button>
                      ) : null}
                      {employee.active && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => archiveMutation.mutate(employee.id)}
                          disabled={archiveMutation.isPending}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {managedPieceEmployee ? (
        <div className="section-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ marginTop: 0 }}>
                Piece rates for {managedPieceEmployee.name}
              </h3>
              <p style={{ marginBottom: 8, color: "var(--color-muted)" }}>
                Set per-unit rates for this manufacturing worker.
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setManagedPieceEmployee(null)}>
              Close
            </button>
          </div>

          {pieceRatesQuery.isLoading ? (
            <p>Loading piece rates…</p>
          ) : (
            <>
              <form className="form-grid two-columns" onSubmit={handleAddPieceRate}>
                <label>
                  Manufactured piece *
                  <select
                    value={pieceForm.productId}
                    onChange={(event) =>
                      setPieceForm((prev) => ({ ...prev, productId: event.target.value }))
                    }
                    required
                    disabled={manufacturedProducts.length === 0}
                  >
                    <option value="">Select product</option>
                    {manufacturedProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  {manufacturedProducts.length === 0 ? (
                    <small>No manufactured products found.</small>
                  ) : null}
                </label>
                <label>
                  Rate (per unit) *
                  <input
                    type="number"
                    step="any"
                    value={pieceForm.rate}
                    onChange={(event) =>
                      setPieceForm((prev) => ({ ...prev, rate: event.target.value }))
                    }
                    placeholder="5"
                    required
                  />
                </label>
                <label>
                  Helper rate (per unit)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={pieceForm.helperRate}
                    onChange={(event) =>
                      setPieceForm((prev) => ({ ...prev, helperRate: event.target.value }))
                    }
                    placeholder="Optional"
                  />
                </label>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={createPieceRateMutation.isPending}
                  >
                    {createPieceRateMutation.isPending ? "Saving…" : "Add piece rate"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setPieceForm({
                        productId: "",
                        rate: "",
                        helperRate: "",
                      })
                    }
                  >
                    Clear
                  </button>
                </div>
              </form>

              {pieceRatesQuery.data && pieceRatesQuery.data.length > 0 ? (
                <table style={{ marginTop: 16 }}>
                  <thead>
                    <tr>
                      <th>Piece</th>
                      <th>Rate</th>
                      <th>Helper rate</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieceRatesQuery.data.map((rate) => (
                      <tr key={rate.id}>
                        <td>{rate.product?.name ?? "Product"}</td>
                        <td>${rate.rate.toFixed(2)}</td>
                        <td>{rate.helperRate ? `$${rate.helperRate.toFixed(2)}` : "—"}</td>
                        <td>{rate.isActive ? "Active" : "Inactive"}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleEditPieceRate(rate)}
                              disabled={updatePieceRateMutation.isPending}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleTogglePieceRate(rate)}
                              disabled={updatePieceRateMutation.isPending}
                            >
                              {rate.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleDeletePieceRate(rate)}
                              disabled={deletePieceRateMutation.isPending}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ marginTop: 16 }}>No piece rates recorded yet.</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default EmployeesPage;
