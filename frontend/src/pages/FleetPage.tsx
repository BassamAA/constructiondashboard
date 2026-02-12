import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchTrucks,
  createTruck,
  updateTruck,
  deleteTruck,
  fetchTruckRepairs,
  createTruckRepair,
  type MutateTruckPayload,
  type CreateTruckRepairPayload,
} from "../api/trucks";
import { fetchDrivers, createDriver, type CreateDriverPayload } from "../api/drivers";
import { fetchSuppliers } from "../api/suppliers";
import { fetchTools } from "../api/tools";
import type { Driver, Supplier, Truck } from "../types";

const EMPTY_TRUCK_FORM = {
  plateNo: "",
  driverId: "",
};

const EMPTY_DRIVER_FORM = {
  name: "",
  phone: "",
};

const EMPTY_REPAIR_FORM = {
  truckId: "",
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  supplierId: "",
  description: "",
  type: "REPAIR",
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function FleetPage() {
  const queryClient = useQueryClient();
  const { data: trucks = [], status: trucksStatus } = useQuery({
    queryKey: ["trucks"],
    queryFn: fetchTrucks,
  });
  const { data: drivers = [], status: driversStatus } = useQuery({
    queryKey: ["drivers"],
    queryFn: fetchDrivers,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: fetchSuppliers,
  });
  const { data: tools = [] } = useQuery({
    queryKey: ["tools"],
    queryFn: fetchTools,
  });

  const [truckForm, setTruckForm] = useState({ ...EMPTY_TRUCK_FORM });
  const [truckFormError, setTruckFormError] = useState<string | null>(null);
  const [editingTruckId, setEditingTruckId] = useState<number | null>(null);
const [editForm, setEditForm] = useState({ ...EMPTY_TRUCK_FORM });
  const [insuranceExpiry, setInsuranceExpiry] = useState<string>("");
  const [driverForm, setDriverForm] = useState({ ...EMPTY_DRIVER_FORM });
  const [driverFormError, setDriverFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [repairForm, setRepairForm] = useState({ ...EMPTY_REPAIR_FORM, date: new Date().toISOString().slice(0, 10) });
  const [repairFormError, setRepairFormError] = useState<string | null>(null);
  const [maintenanceView, setMaintenanceView] = useState<"REPAIR" | "OIL_CHANGE" | "INSURANCE">(
    "REPAIR",
  );

  const createTruckMutation = useMutation({
    mutationFn: (payload: MutateTruckPayload) => createTruck(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
      setTruckForm({ ...EMPTY_TRUCK_FORM });
      setInsuranceExpiry("");
      setTruckFormError(null);
    },
    onError: (err: any) => {
      setTruckFormError(err?.response?.data?.error ?? err?.message ?? "Failed to add vehicle");
    },
  });

  const updateTruckMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MutateTruckPayload }) =>
      updateTruck(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
      setEditingTruckId(null);
      setEditForm({ ...EMPTY_TRUCK_FORM });
      setTruckFormError(null);
    },
    onError: (err: any) => {
      setTruckFormError(err?.response?.data?.error ?? err?.message ?? "Failed to update vehicle");
    },
  });

  const deleteTruckMutation = useMutation({
    mutationFn: (id: number) => deleteTruck(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trucks"] });
      setDeleteId(null);
    },
    onError: (err: any) => {
      setTruckFormError(err?.response?.data?.error ?? err?.message ?? "Failed to delete vehicle");
      setDeleteId(null);
    },
  });

  const createDriverMutation = useMutation({
    mutationFn: (payload: CreateDriverPayload) => createDriver(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDriverForm({ ...EMPTY_DRIVER_FORM });
      setDriverFormError(null);
    },
    onError: (err: any) => {
      setDriverFormError(err?.response?.data?.error ?? err?.message ?? "Failed to add driver");
    },
  });

  const selectedRepairTruckId = repairForm.truckId;
  const repairsQuery = useQuery({
    queryKey: ["truck-repairs", selectedRepairTruckId],
    queryFn: () => fetchTruckRepairs(Number(selectedRepairTruckId)),
    enabled: Boolean(selectedRepairTruckId),
  });

  const createRepairMutation = useMutation({
    mutationFn: ({
      truckId,
      payload,
    }: {
      truckId: number;
      payload: CreateTruckRepairPayload;
    }) => createTruckRepair(truckId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["truck-repairs", String(variables.truckId)],
      });
      setRepairForm((prev) => ({
        ...prev,
        amount: "",
        description: "",
      }));
      setRepairFormError(null);
    },
    onError: (err: any) => {
      setRepairFormError(err?.response?.data?.error ?? err?.message ?? "Failed to log repair");
    },
  });

  const isSavingTruck =
    createTruckMutation.isPending || updateTruckMutation.isPending || deleteTruckMutation.isPending;
  const isSavingDriver = createDriverMutation.isPending;

  const driverLookup = useMemo(() => {
    return new Map(drivers.map((driver) => [driver.id, driver]));
  }, [drivers]);

  useEffect(() => {
    if (trucks.length > 0 && !repairForm.truckId) {
      setRepairForm((prev) => ({ ...prev, truckId: String(trucks[0].id) }));
    }
  }, [trucks, repairForm.truckId]);

  useEffect(() => {
    setRepairForm((prev) => ({
      ...prev,
      type: maintenanceView,
      supplierId: maintenanceView === "OIL_CHANGE" ? "" : prev.supplierId,
    }));
  }, [maintenanceView]);

  const handleSubmitTruck = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTruckFormError(null);

    const plate = truckForm.plateNo.trim();
    if (!plate) {
      setTruckFormError("Enter a vehicle identifier (plate or machine code)");
      return;
    }

    const driverId =
      truckForm.driverId && truckForm.driverId.trim().length > 0
        ? Number(truckForm.driverId)
        : null;
    if (driverId !== null && Number.isNaN(driverId)) {
      setTruckFormError("Select a valid driver");
      return;
    }

    createTruckMutation.mutate({
      plateNo: plate,
      driverId,
      insuranceExpiry: insuranceExpiry || undefined,
    });
  };

  const handleStartEdit = (truck: Truck) => {
    setEditingTruckId(truck.id);
    setEditForm({
      plateNo: truck.plateNo,
      driverId: truck.driverId ? String(truck.driverId) : "",
    });
    setInsuranceExpiry(truck.insuranceExpiry ? truck.insuranceExpiry.slice(0, 10) : "");
    setTruckFormError(null);
  };

  const handleCancelEdit = () => {
    setEditingTruckId(null);
    setEditForm({ ...EMPTY_TRUCK_FORM });
    setTruckFormError(null);
  };

  const handleSaveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingTruckId === null) return;
    setTruckFormError(null);

    const plate = editForm.plateNo.trim();
    if (!plate) {
      setTruckFormError("Enter a vehicle identifier (plate or machine code)");
      return;
    }

    const driverId =
      editForm.driverId && editForm.driverId.trim().length > 0
        ? Number(editForm.driverId)
        : null;
    if (driverId !== null && Number.isNaN(driverId)) {
      setTruckFormError("Select a valid driver");
      return;
    }

    updateTruckMutation.mutate({
      id: editingTruckId,
      payload: { plateNo: plate, driverId, insuranceExpiry: insuranceExpiry || null },
    });
  };

  const handleDeleteTruck = (truck: Truck) => {
    if (deleteTruckMutation.isPending) return;
    const confirmed = window.confirm(
      `Delete ${truck.plateNo}? Receipts that reference it will lose the vehicle link.`,
    );
    if (!confirmed) return;
    setDeleteId(truck.id);
    deleteTruckMutation.mutate(truck.id);
  };

  const handleSubmitDriver = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDriverFormError(null);

    const name = driverForm.name.trim();
    if (!name) {
      setDriverFormError("Driver name is required");
      return;
    }

    const payload: CreateDriverPayload = {
      name,
      phone: driverForm.phone?.trim() ? driverForm.phone.trim() : undefined,
    };
    createDriverMutation.mutate(payload);
  };

  const handleSubmitRepair = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRepairFormError(null);

    if (!repairForm.truckId) {
      setRepairFormError("Select a vehicle");
      return;
    }

    const payload: CreateTruckRepairPayload = {
      amount: 0,
      date: repairForm.date,
      description: repairForm.description.trim() ? repairForm.description.trim() : undefined,
      type: repairForm.type as any,
    };

    if (repairForm.type === "OIL_CHANGE") {
      const qty = Number(repairForm.amount);
      if (Number.isNaN(qty) || qty <= 0) {
        setRepairFormError("Enter liters used");
        return;
      }
      payload.quantity = qty;
      const toolId = repairForm.supplierId ? Number(repairForm.supplierId) : undefined;
      if (!toolId || Number.isNaN(toolId)) {
        setRepairFormError("Select oil from stock");
        return;
      }
      payload.toolId = toolId;
    } else {
      const amount = Number(repairForm.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        setRepairFormError("Enter a valid amount");
        return;
      }
      payload.amount = amount;
      if (repairForm.supplierId && repairForm.supplierId.trim().length > 0) {
        const supplierId = Number(repairForm.supplierId);
        if (Number.isNaN(supplierId)) {
          setRepairFormError("Select a valid supplier");
          return;
        }
        payload.supplierId = supplierId;
      }
    }

    createRepairMutation.mutate({
      truckId: Number(repairForm.truckId),
      payload,
    });
  };

  const filteredRepairs =
    repairsQuery.data?.filter((r) => (r.type ?? "REPAIR") === maintenanceView) ?? [];

  return (
    <section>
      <header>
        <h2>Fleet & Machinery</h2>
        <p>Register vehicles or heavy equipment and keep track of who is assigned to each unit.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Add vehicle or machine</h3>
        <p style={{ marginTop: -8 }}>
          Use this form to log new trucks, loaders, or other equipment. Assigning a driver/operator
          is optional and can be updated later.
        </p>
        <form onSubmit={handleSubmitTruck} className="form-grid two-columns">
          <label>
            Identifier *
            <input
              type="text"
              value={truckForm.plateNo}
              onChange={(event) =>
                setTruckForm((prev) => ({ ...prev, plateNo: event.target.value }))
              }
              placeholder="e.g. ABC-123 or Loader #2"
              disabled={isSavingTruck}
              required
            />
          </label>
          <label>
            Assigned driver
            <select
              value={truckForm.driverId}
              onChange={(event) =>
                setTruckForm((prev) => ({ ...prev, driverId: event.target.value }))
              }
              disabled={isSavingTruck}
            >
              <option value="">Unassigned</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Insurance expiry
            <input
              type="date"
              value={insuranceExpiry}
              onChange={(e) => setInsuranceExpiry(e.target.value)}
              disabled={isSavingTruck}
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSavingTruck}>
              {createTruckMutation.isPending ? "Adding…" : "Add vehicle"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setTruckForm({ ...EMPTY_TRUCK_FORM });
                setTruckFormError(null);
              }}
              disabled={isSavingTruck}
            >
              Reset
            </button>
          </div>
          {truckFormError ? (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {truckFormError}
            </div>
          ) : null}
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Fleet roster</h3>
        {trucksStatus === "pending" ? (
          <p>Loading vehicles…</p>
        ) : trucks.length === 0 ? (
          <p>No vehicles registered yet. Add one using the form above.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Identifier</th>
                  <th style={{ width: "30%" }}>Assigned driver</th>
                  <th style={{ width: "20%" }}>Insurance expiry</th>
                  <th style={{ width: "20%" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {trucks.map((truck) => {
                  const isEditing = editingTruckId === truck.id;
                  const assignedDriver = truck.driverId
                    ? driverLookup.get(truck.driverId)
                    : null;
                  return (
                    <tr key={truck.id}>
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.plateNo}
                            onChange={(event) =>
                              setEditForm((prev) => ({ ...prev, plateNo: event.target.value }))
                            }
                            disabled={isSavingTruck}
                          />
                        ) : (
                          truck.plateNo
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            value={editForm.driverId}
                            onChange={(event) =>
                              setEditForm((prev) => ({ ...prev, driverId: event.target.value }))
                            }
                            disabled={isSavingTruck}
                          >
                            <option value="">Unassigned</option>
                            {drivers.map((driver: Driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.name}
                              </option>
                            ))}
                          </select>
                        ) : assignedDriver ? (
                          assignedDriver.name
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="date"
                            value={insuranceExpiry}
                            onChange={(e) => setInsuranceExpiry(e.target.value)}
                            disabled={isSavingTruck}
                          />
                        ) : truck.insuranceExpiry ? (
                          new Date(truck.insuranceExpiry).toLocaleDateString()
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <form
                            onSubmit={handleSaveEdit}
                            style={{ display: "flex", gap: 8, justifyContent: "center" }}
                          >
                            <button
                              type="submit"
                              className="primary-button"
                              style={{ padding: "6px 12px" }}
                              disabled={isSavingTruck}
                            >
                              {updateTruckMutation.isPending ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              style={{ padding: "6px 12px" }}
                              onClick={handleCancelEdit}
                              disabled={isSavingTruck}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <div className="table-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ padding: "6px 12px" }}
                              onClick={() => handleStartEdit(truck)}
                              disabled={isSavingTruck}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="ghost-button"
                              style={{ padding: "6px 12px" }}
                              onClick={() => handleDeleteTruck(truck)}
                              disabled={isSavingTruck || deleteId === truck.id}
                            >
                              {deleteTruckMutation.isPending && deleteId === truck.id
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          </div>
                        )}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>Maintenance</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={maintenanceView === "REPAIR" ? "secondary-button" : "ghost-button"}
              onClick={() => setMaintenanceView("REPAIR")}
            >
              Repairs
            </button>
            <button
              type="button"
              className={maintenanceView === "OIL_CHANGE" ? "secondary-button" : "ghost-button"}
              onClick={() => setMaintenanceView("OIL_CHANGE")}
            >
              Oil changes
            </button>
            <button
              type="button"
              className={maintenanceView === "INSURANCE" ? "secondary-button" : "ghost-button"}
              onClick={() => setMaintenanceView("INSURANCE")}
            >
              Insurance
            </button>
          </div>
        </div>
        <p style={{ marginTop: -8 }}>
          Log maintenance costs against a specific vehicle. Each entry automatically posts to your cash
          outflows so finances stay up to date.
        </p>
        {trucks.length === 0 ? (
          <p>Add a vehicle first to start logging repairs.</p>
        ) : (
          <>
            <form onSubmit={handleSubmitRepair} className="form-grid two-columns">
              <label>
                Vehicle *
                <select
                  value={repairForm.truckId}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, truckId: event.target.value }))
                  }
                  disabled={createRepairMutation.isPending}
                >
                  <option value="">Select vehicle</option>
                  {trucks.map((truck) => (
                    <option key={truck.id} value={truck.id}>
                      {truck.plateNo}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={repairForm.type}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, type: event.target.value }))
                  }
                  disabled={createRepairMutation.isPending}
                >
                  <option value="REPAIR">Repair</option>
                  <option value="OIL_CHANGE">Oil change</option>
                  <option value="INSURANCE">Insurance</option>
                </select>
              </label>
              <label>
                {repairForm.type === "OIL_CHANGE" ? "Oil from stock" : "Supplier"}
                <select
                  value={repairForm.supplierId}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, supplierId: event.target.value }))
                  }
                  disabled={createRepairMutation.isPending}
                >
                  {repairForm.type === "OIL_CHANGE" ? (
                    <>
                      <option value="">Select oil stock</option>
                      {tools.map((tool) => (
                        <option key={tool.id} value={tool.id}>
                          {tool.name} ({tool.quantity} {tool.unit ?? ""} on hand)
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="">Internal (our own work)</option>
                      {suppliers.map((supplier: Supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <label>
                {repairForm.type === "OIL_CHANGE" ? "Liters used *" : "Amount *"}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={repairForm.amount}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  required
                  disabled={createRepairMutation.isPending}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={repairForm.date}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, date: event.target.value }))
                  }
                  disabled={createRepairMutation.isPending}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Notes
                <input
                  type="text"
                  value={repairForm.description}
                  onChange={(event) =>
                    setRepairForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="What was repaired?"
                  disabled={createRepairMutation.isPending}
                />
              </label>
              <div style={{ gridColumn: "1 / -1" }}>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={createRepairMutation.isPending || !repairForm.truckId}
                >
                  {createRepairMutation.isPending ? "Logging…" : "Log repair expense"}
                </button>
              </div>
              {repairFormError ? (
                <div className="error-text" style={{ gridColumn: "1 / -1" }}>
                  {repairFormError}
                </div>
              ) : null}
            </form>

            <div style={{ marginTop: 24 }}>
              {repairsQuery.isLoading ? (
                <p>Loading repair history…</p>
              ) : repairsQuery.error ? (
                <p className="error-text">Failed to load repair history.</p>
              ) : filteredRepairs.length === 0 ? (
                <p>No entries logged for this vehicle yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: "20%" }}>Date</th>
                        <th style={{ width: "18%" }}>Category</th>
                        <th style={{ width: "22%" }}>Supplier</th>
                        <th style={{ width: "30%" }}>Description</th>
                        <th style={{ width: "10%", textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRepairs.map((repair) => (
                        <tr key={repair.id}>
                          <td>{new Date(repair.date).toLocaleDateString()}</td>
                          <td>
                            {repair.type === "OIL_CHANGE"
                              ? "Oil change"
                              : repair.type === "INSURANCE"
                                ? "Insurance"
                                : "Repair"}
                          </td>
                          <td>{repair.type === "OIL_CHANGE" ? repair.tool?.name ?? "Stock" : repair.supplier?.name ?? "Internal"}</td>
                          <td>
                            {repair.type === "OIL_CHANGE"
                              ? `${repair.quantity ?? 0} ${repair.tool?.unit ?? "L"}`
                              : repair.description ?? "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {repair.type === "OIL_CHANGE"
                              ? `${repair.quantity ?? 0} ${repair.tool?.unit ?? "L"}`
                              : formatCurrency(repair.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Driver directory</h3>
        <p style={{ marginTop: -8 }}>
          Create driver/operator profiles so they can be assigned to equipment and used on receipts.
        </p>
        <form onSubmit={handleSubmitDriver} className="form-grid two-columns">
          <label>
            Name *
            <input
              type="text"
              value={driverForm.name}
              onChange={(event) =>
                setDriverForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Driver name"
              required
              disabled={isSavingDriver}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={driverForm.phone}
              onChange={(event) =>
                setDriverForm((prev) => ({ ...prev, phone: event.target.value }))
              }
              placeholder="Optional contact number"
              disabled={isSavingDriver}
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={isSavingDriver}>
              {createDriverMutation.isPending ? "Saving…" : "Add driver"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setDriverForm({ ...EMPTY_DRIVER_FORM });
                setDriverFormError(null);
              }}
              disabled={isSavingDriver}
            >
              Reset
            </button>
          </div>
          {driverFormError ? (
            <div className="error-text" style={{ gridColumn: "1 / -1" }}>
              {driverFormError}
            </div>
          ) : null}
        </form>
        <div style={{ marginTop: 24 }}>
          {driversStatus === "pending" ? (
            <p>Loading drivers…</p>
          ) : drivers.length === 0 ? (
            <p>No drivers yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {drivers.map((driver) => (
                <li key={driver.id}>
                  {driver.name}
                  {driver.phone ? ` – ${driver.phone}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default FleetPage;
