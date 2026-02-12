import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchDieselPurchases, fetchDieselLogs, createDieselLog } from "../api/diesel";
import { fetchTrucks } from "../api/trucks";
import { fetchDrivers } from "../api/drivers";
import { fetchProducts } from "../api/products";
import type {
  DieselLog,
  DieselLogsResponse,
  DieselPurchasesResponse,
  Driver,
  Product,
  Truck,
} from "../types";

const formatNumber = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function DieselPage() {
  const queryClient = useQueryClient();

  const { data: purchasesData } = useQuery<DieselPurchasesResponse>({
    queryKey: ["diesel", "purchases"],
    queryFn: fetchDieselPurchases,
  });

  const { data: logsData } = useQuery<DieselLogsResponse>({
    queryKey: ["diesel", "logs"],
    queryFn: fetchDieselLogs,
  });

  const { data: trucks = [] } = useQuery<Truck[]>({
    queryKey: ["trucks"],
    queryFn: fetchTrucks,
  });

  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["drivers"],
    queryFn: fetchDrivers,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const fuelProducts = useMemo(
    () =>
      products.filter(
        (product) => product.isFuel || product.name.toLowerCase().includes("diesel"),
      ),
    [products],
  );

  const [formState, setFormState] = useState({
    date: "",
    truckId: "",
    driverId: "",
    liters: "",
    notes: "",
    productId: fuelProducts.length === 1 ? String(fuelProducts[0].id) : "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createDieselLog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diesel", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setFormState((prev) => ({
        date: prev.date,
        truckId: "",
        driverId: "",
        liters: "",
        notes: "",
        productId: fuelProducts.length === 1 ? String(fuelProducts[0].id) : prev.productId,
      }));
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to log diesel usage");
    },
  });


  const totalPurchasedLiters = purchasesData?.totals.liters ?? 0;
  const totalUsedLiters = logsData?.totals.liters ?? 0;
  const estimatedStockLiters = Math.max(totalPurchasedLiters - totalUsedLiters, 0);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const liters = Number(formState.liters);
    if (!formState.liters || Number.isNaN(liters) || liters <= 0) {
      setFormError("Enter a valid number of liters");
      return;
    }

    const payload = {
      date: formState.date || undefined,
      truckId: formState.truckId ? Number(formState.truckId) : undefined,
      driverId: formState.driverId ? Number(formState.driverId) : undefined,
      liters,
      notes: formState.notes.trim() || undefined,
      productId: formState.productId ? Number(formState.productId) : undefined,
    };

    createMutation.mutate(payload);
  }

  const purchases = purchasesData?.purchases ?? [];
  const logs = logsData?.logs ?? [];

  return (
    <section>
      <header>
        <h2>Diesel management</h2>
        <p>Track diesel purchases and log each truck refill to keep fuel usage under control.</p>
      </header>

      <div className="stat-grid" style={{ marginTop: 24 }}>
        <div className="stat-card">
          <h4>Purchased (all time)</h4>
          <strong>{formatNumber(totalPurchasedLiters)} L</strong>
          
        </div>
        <div className="stat-card">
          <h4>Used (logged)</h4>
          <strong>{formatNumber(totalUsedLiters)} L</strong>
        </div>
        <div className="stat-card">
          <h4>Estimated on hand</h4>
          <strong>{formatNumber(estimatedStockLiters)} L</strong>
          <span className="badge">Update via inventory purchases</span>
        </div>
      </div>

      <div className="section-card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Log a refill</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Date
            <input
              type="date"
              value={formState.date}
              onChange={(event) => setFormState((prev) => ({ ...prev, date: event.target.value }))}
            />
          </label>
          <label>
            Truck
            <select
              value={formState.truckId}
              onChange={(event) => setFormState((prev) => ({ ...prev, truckId: event.target.value }))}
            >
              <option value="">Unassigned</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plateNo}
                </option>
              ))}
            </select>
          </label>
          <label>
            Driver
            <select
              value={formState.driverId}
              onChange={(event) => setFormState((prev) => ({ ...prev, driverId: event.target.value }))}
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
            Fuel product
            <select
              value={formState.productId}
              onChange={(event) => setFormState((prev) => ({ ...prev, productId: event.target.value }))}
            >
              <option value="">Auto detect diesel</option>
              {fuelProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Liters dispensed *
            <input
              type="number"
              min="0"
              step="any"
              value={formState.liters}
              onChange={(event) => setFormState((prev) => ({ ...prev, liters: event.target.value }))}
              placeholder="60"
              required
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Notes
            <textarea
              value={formState.notes}
              onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Optional notes about this fill-up"
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save log"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setFormState({
                  date: formState.date,
                  truckId: "",
                  driverId: "",
                  liters: "",
                  notes: "",
                  productId: fuelProducts.length === 1 ? String(fuelProducts[0].id) : "",
                });
                setFormError(null);
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

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Recent refills</h3>
        {logs.length === 0 ? (
          <p>No diesel usage logged yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Truck</th>
                <th>Driver</th>
                <th>Liters</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: DieselLog) => (
                <tr key={log.id}>
                  <td>{new Date(log.date).toLocaleDateString()}</td>
                  <td>{log.truck?.plateNo ?? "—"}</td>
                  <td>{log.driver?.name ?? "—"}</td>
                  <td>{formatNumber(log.liters)}</td>
                  <td>{log.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Purchases</h3>
        {purchases.length === 0 ? (
          <p>No diesel purchases recorded. Record purchases via the Inventory page using a fuel product.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Product</th>
                <th>Quantity (L)</th>
                <th>Total cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.entryDate ?? entry.createdAt).toLocaleDateString()}</td>
                  <td>{entry.supplier?.name ?? "—"}</td>
                  <td>{entry.product.name}</td>
                  <td>{formatNumber(entry.quantity)}</td>
                  <td>
                    {entry.totalCost !== null && entry.totalCost !== undefined
                      ? formatNumber(Number(entry.totalCost))
                      : "—"}
                  </td>
                  <td>{entry.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default DieselPage;
