import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createTool, deleteTool, fetchTools, updateTool } from "../api/tools";
import type { Tool } from "../types";

export default function ToolsPage() {
  const queryClient = useQueryClient();
  const { data: tools = [], isLoading, error } = useQuery({
    queryKey: ["tools"],
    queryFn: fetchTools,
  });
  const [form, setForm] = useState<{ name: string; quantity: string; unit: string; notes: string }>({
    name: "",
    quantity: "",
    unit: "",
    notes: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Tool> & { name: string } = {
        name: form.name.trim(),
        quantity: form.quantity ? Number(form.quantity) : 0,
        unit: form.unit.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };
      return createTool(payload);
    },
    onSuccess: () => {
      setForm({ name: "", quantity: "", unit: "", notes: "" });
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    },
    onError: (err: any) => setFormError(err?.response?.data?.error ?? err?.message ?? "Failed to save tool"),
  });

  const updateMutation = useMutation({
    mutationFn: (tool: Tool) => updateTool(tool.id, tool),
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTool(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tools"] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const qty = form.quantity ? Number(form.quantity) : 0;
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (Number.isNaN(qty) || qty < 0) {
      setFormError("Quantity must be zero or greater");
      return;
    }
    createMutation.mutate();
  };

  return (
    <section>
      <header>
        <h2>Tools & Supplies</h2>
        <p>Track oil, tools, and consumables you keep on hand.</p>
      </header>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Add item</h3>
        <form onSubmit={handleSubmit} className="form-grid two-columns">
          <label>
            Name *
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </label>
          <label>
            Quantity on hand
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
            />
          </label>
          <label>
            Unit
            <input
              type="text"
              value={form.unit}
              onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
              placeholder="e.g. liters, pcs"
            />
          </label>
          <label>
            Notes
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Brand, location, etc."
            />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="primary-button" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save item"}
            </button>
            {formError ? <div className="error-text">{formError}</div> : null}
          </div>
        </form>
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>Inventory</h3>
        {isLoading ? (
          <p>Loading…</p>
        ) : error ? (
          <p className="error-text">Failed to load tools.</p>
        ) : tools.length === 0 ? (
          <p>No items tracked yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>Name</th>
                  <th style={{ width: "20%", textAlign: "right" }}>Quantity</th>
                  <th style={{ width: "15%" }}>Unit</th>
                  <th style={{ width: "25%" }}>Notes</th>
                  <th style={{ width: "10%" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const isEditing = editingId === tool.id;
                  return (
                    <tr key={tool.id}>
                      <td>
                        {isEditing ? (
                          <input
                            value={tool.name}
                            onChange={(e) => updateMutation.mutate({ ...tool, name: e.target.value })}
                          />
                        ) : (
                          tool.name
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{tool.quantity.toLocaleString()}</td>
                      <td>{tool.unit ?? "—"}</td>
                      <td>{tool.notes ?? "—"}</td>
                      <td>
                        <button
                          className="ghost-button"
                          onClick={() => deleteMutation.mutate(tool.id)}
                          disabled={deleteMutation.isPending}
                        >
                          Delete
                        </button>
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
