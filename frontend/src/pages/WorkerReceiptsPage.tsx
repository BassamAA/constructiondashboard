import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWorkerReceiptById, fetchWorkerReceiptByNumber } from "../api/worker";
import type { Receipt } from "../types";
import { useAuth } from "../context/AuthContext";

type SearchMode = "number" | "id";

export function WorkerReceiptsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [mode, setMode] = useState<SearchMode>("number");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const queryLabel = useMemo(() => (mode === "number" ? "Receipt number" : "Receipt ID"), [mode]);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      setError(`Enter a ${mode === "number" ? "receipt number" : "receipt ID"}`);
      return;
    }
    setLoading(true);
    setError(null);
    setReceipt(null);
    try {
      const nextReceipt =
        mode === "number"
          ? await fetchWorkerReceiptByNumber(query.trim())
          : await fetchWorkerReceiptById(Number(query.trim()));
      setReceipt(nextReceipt);
    } catch (err: any) {
      const message =
        err?.response?.data?.error ?? err?.message ?? "Unable to load receipt. Try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const openPrintable = () => {
    if (!receipt) return;
    navigate(`/worker/receipts/print?receiptId=${receipt.id}`);
  };

  if (!can("receipts:print")) {
    return (
      <section style={{ padding: 32 }}>
        <p>You do not have access to the worker print portal.</p>
      </section>
    );
  }

  return (
    <section>
      <header>
        <h2>Worker Receipt Print Portal</h2>
        <p>Search and print customer receipts.</p>
      </header>

      <div className="section-card">
        <form onSubmit={handleSearch} className="form-grid two-columns" style={{ marginBottom: 24 }}>
          <label>
            Search mode
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as SearchMode);
                setQuery("");
                setReceipt(null);
                setError(null);
              }}
            >
              <option value="number">By receipt number</option>
              <option value="id">By receipt ID</option>
            </select>
          </label>
          <label>
            {queryLabel}
            <input
              type={mode === "id" ? "number" : "text"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={mode === "number" ? "e.g. 3071" : "e.g. 142"}
            />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </button>
            {receipt ? (
              <button type="button" className="secondary-button" onClick={openPrintable}>
                Open printable view
              </button>
            ) : null}
          </div>
        </form>

        {error ? <p className="error-text">{error}</p> : null}

        {receipt ? (
          <div className="section-card" style={{ marginTop: 16 }}>
            <h4 style={{ marginTop: 0 }}>Receipt summary</h4>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
              <li>
                <strong>Receipt:</strong> {receipt.receiptNo ?? `#${receipt.id}`}
              </li>
              <li>
                <strong>Date:</strong> {new Date(receipt.date).toLocaleString()}
              </li>
              <li>
                <strong>Customer:</strong>{" "}
                {receipt.customer ? receipt.customer.name : receipt.walkInName ?? "Walk-in"}
              </li>
              <li>
                <strong>Items:</strong> {receipt.items.length}
              </li>
              <li>
                <strong>Total:</strong> ${receipt.total.toFixed(2)}
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default WorkerReceiptsPage;
