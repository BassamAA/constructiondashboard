import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchInventoryEntry } from "../api/inventory";
import type { InventoryEntry } from "../types";

function LabelValue({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div>{value ?? "—"}</div>
    </div>
  );
}

export default function InventoryPrintPage() {
  const [searchParams] = useSearchParams();
  const idParam = searchParams.get("inventoryId");
  const inventoryId = idParam ? Number(idParam) : NaN;
  const [autoPrinted, setAutoPrinted] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory", "print", inventoryId],
    queryFn: () => fetchInventoryEntry(inventoryId),
    enabled: Number.isFinite(inventoryId),
  });

  useEffect(() => {
    if (data && !autoPrinted) {
      window.print();
      setAutoPrinted(true);
    }
  }, [data, autoPrinted]);

  const entry = data as InventoryEntry | undefined;

  const laborTotal = useMemo(() => {
    if (!entry) return 0;
    return Number(entry.laborAmount ?? 0) + Number(entry.helperLaborAmount ?? 0);
  }, [entry]);

  if (!idParam || Number.isNaN(inventoryId)) {
    return <div style={{ padding: 24 }}>Missing or invalid inventoryId</div>;
  }

  if (isLoading) {
    return <div style={{ padding: 24 }}>Loading inventory entry…</div>;
  }

  if (error || !entry) {
    return <div style={{ padding: 24 }}>Failed to load inventory entry.</div>;
  }

  const isPurchase = entry.type === "PURCHASE";
  const entryDate = new Date(entry.entryDate ?? entry.createdAt);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        color: "#111827",
      }}
    >
      <header style={{ marginBottom: 24, display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Inventory Entry</div>
          <div style={{ color: "#6b7280" }}>{entry.inventoryNo}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 600 }}>{isPurchase ? "Purchase" : "Production"}</div>
          <div style={{ color: "#6b7280" }}>{entryDate.toLocaleDateString()}</div>
        </div>
      </header>

      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <LabelValue label="Product" value={entry.product?.name ?? `#${entry.productId}`} />
        <LabelValue label="Quantity" value={entry.quantity} />
        {isPurchase ? (
          <>
            <LabelValue label="Supplier" value={entry.supplier?.name ?? "—"} />
            <LabelValue
              label="Unit cost"
              value={
                entry.unitCost != null ? `$${Number(entry.unitCost).toFixed(2)}` : "—"
              }
            />
            <LabelValue
              label="Total cost"
              value={
                entry.totalCost != null ? `$${Number(entry.totalCost).toFixed(2)}` : "—"
              }
            />
            <LabelValue label="TVA eligible" value={entry.tvaEligible ? "Yes" : "No"} />
            <LabelValue label="Status" value={entry.isPaid ? "Paid" : "Unpaid"} />
          </>
        ) : (
          <>
            <LabelValue label="Makbas" value={entry.productionSite ?? "—"} />
            <LabelValue
              label="Powder"
              value={
                entry.powderProduct
                  ? `${entry.powderProduct.name} (${entry.powderUsed ?? 0})`
                  : "—"
              }
            />
            <LabelValue
              label="Cement"
              value={
                entry.cementProduct
                  ? `${entry.cementProduct.name} (${entry.cementUsed ?? 0})`
                  : "—"
              }
            />
            <LabelValue
              label="Labor"
              value={
                laborTotal > 0
                  ? `${entry.laborPaid ? "Paid" : "Unpaid"} – $${laborTotal.toFixed(2)}`
                  : "—"
              }
            />
            <LabelValue
              label="Crew"
              value={
                entry.workerEmployee || entry.helperEmployee
                  ? [
                      entry.workerEmployee?.name ?? null,
                      entry.helperEmployee?.name ? `Helper: ${entry.helperEmployee.name}` : null,
                    ]
                      .filter(Boolean)
                      .join(" • ")
                  : "—"
              }
            />
          </>
        )}
        <LabelValue label="Created" value={new Date(entry.createdAt).toLocaleString()} />
      </section>

      {entry.notes ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Notes</div>
          <div>{entry.notes}</div>
        </section>
      ) : null}
    </div>
  );
}
