import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWorkerReceiptById } from "../api/worker";
import { logReceiptPrint } from "../api/audit";
import type { Receipt } from "../types";
import { findDisplayOption } from "../constants/materials";
import { useAuth } from "../context/AuthContext";
import { formatLebanonDate, formatLebanonDateTime } from "../utils/datetime";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function WorkerReceiptPrintPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const searchParams = useLocation();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receiptId = useMemo(() => {
    const params = new URLSearchParams(searchParams.search);
    const idParam = params.get("receiptId");
    if (!idParam) return null;
    const numeric = Number(idParam);
    return Number.isNaN(numeric) ? null : numeric;
  }, [searchParams.search]);

  useEffect(() => {
    if (!receiptId) {
      setError("Missing receipt identifier.");
      return;
    }

    let cancelled = false;
    setError(null);
    fetchWorkerReceiptById(receiptId)
      .then((data) => {
        if (!cancelled) {
          setReceipt(data);
          logReceiptPrint(data.id).catch(() => {});
          setTimeout(() => window.print(), 300);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.response?.data?.error ?? err?.message ?? "Unable to load receipt for printing.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, receiptId]);

  if (!can("receipts:print")) {
    return (
      <section style={{ padding: 32 }}>
        <p>This printable page is restricted to users with receipt print access.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
        <p className="error-text">{error}</p>
        <button className="secondary-button" onClick={() => navigate("/worker/receipts")}>
          Back to search
        </button>
      </section>
    );
  }

  if (!receipt) {
    return (
      <section style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
        <p>Preparing printable receipt…</p>
      </section>
    );
  }

  const customerName = receipt.customer ? receipt.customer.name : receipt.walkInName ?? "Walk-in";
  const isTVA = receipt.type === "TVA";
  const vatRate = 0.11;
  const vatAmount = Number(receipt.total) * vatRate;
  const totalWithVat = Number(receipt.total) + vatAmount;
  const cardBackground = isTVA ? "#f0f6ff" : "#ffe4ec";

  return (
    <section
      className="receipt-print-wrapper"
      style={{
        padding: 24,
        minHeight: "100vh",
        background: "var(--color-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`
        @media print {
          @page {
            size: A5 portrait;
            margin: 8mm 10mm;
          }

          html,
          body,
          #root,
          #root > * {
            margin: 0;
            padding: 0;
            background: #fff;
            font-size: 1rem;
            line-height: 1.4;
          }

          .receipt-print-wrapper {
            padding: 0;
            margin: 0;
            width: 100%;
            min-height: auto;
            background: transparent;
            align-items: flex-start;
            justify-content: center;
          }

          .print-container {
            width: 148mm;
            max-width: 148mm;
            min-height: 210mm;
            margin: 0 auto;
            padding: 16mm;
            border: none !important;
            border-radius: 0;
            box-shadow: none !important;
            background: ${cardBackground} !important;
            box-sizing: border-box;
            page-break-after: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <article
        className="print-container"
        style={{
          background: cardBackground,
          padding: 20,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
          width: "100%",
          maxWidth: "210mm",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{isTVA ? "TVA Receipt" : "Receipt"}</h1>
            <p style={{ margin: 0, color: "var(--color-muted)" }}>
              Generated {formatLebanonDateTime(Date.now())}
            </p>
            <div style={{ marginTop: 8 }}>
              <strong>Receipt #:</strong> {receipt.receiptNo ?? `#${receipt.id}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
          {isTVA ? (
            <>
              <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Bassam Nabih Al-Assaad</div>
              <div style={{ fontSize: "0.95rem" }}>Trade and Transport S.A.R.L</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: "1.2rem", letterSpacing: 1 }}>N.A.T</div>
              <div style={{ fontSize: "0.95rem" }}>مبيع جميع مواد البناء نقليات وحفريات</div>
            </>
          )}
          </div>
        </header>

        <section style={{ marginBottom: 24, display: "grid", gap: 4 }}>
          <div>
            <strong>Customer:</strong> {customerName}
          </div>
          <div>
            <strong>Date:</strong> {formatLebanonDate(receipt.date)}
          </div>
          {receipt.jobSite ? (
            <div>
              <strong>Job site:</strong> {receipt.jobSite.name}
            </div>
          ) : null}
          {receipt.driver ? (
            <div>
              <strong>Driver:</strong> {receipt.driver.name}
            </div>
          ) : null}
          {receipt.truck ? (
            <div>
              <strong>Truck:</strong> {receipt.truck.plateNo}
            </div>
          ) : null}
        </section>

        {(() => {
          const hasPricedItems = receipt.items.some(
            (item) => item.unitPrice !== null && item.unitPrice !== undefined && item.unitPrice > 0,
          );
          const showPricing = receipt.isPaid && hasPricedItems;
          const hidePricingNotice = !receipt.isPaid && hasPricedItems;

          const renderQuantity = (item: Receipt["items"][number]) => {
            const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
            if (preset && item.displayQuantity !== null && item.displayQuantity !== undefined) {
              return `${item.displayQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${preset.label}`;
            }
            const unit = item.product.unit ?? "";
            return `${item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
          };

          return (
            <>
              {hidePricingNotice ? (
                <p style={{ marginBottom: 12, color: "var(--color-muted)" }}>
                  Prices are hidden until this receipt is marked as paid.
                </p>
              ) : null}

              <table style={{ width: "100%", marginBottom: 24 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Product</th>
                    <th style={{ textAlign: "left" }}>Quantity</th>
                    {showPricing ? <th style={{ textAlign: "right" }}>Unit price</th> : null}
                    {showPricing ? <th style={{ textAlign: "right" }}>Subtotal</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item) => {
                    const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
                    const hasPrice =
                      item.unitPrice !== null && item.unitPrice !== undefined && Number(item.unitPrice) > 0;
                    const baseUnitPrice: number | null = hasPrice ? Number(item.unitPrice) : null;
                    let displayUnitPrice: number | null = baseUnitPrice;
                    if (displayUnitPrice !== null && preset && preset.toBaseFactor > 0) {
                      displayUnitPrice = displayUnitPrice * preset.toBaseFactor;
                    }
                    const lineSubtotal = hasPrice && item.subtotal !== null ? Number(item.subtotal) : null;
                    const formattedUnitPrice =
                      hasPrice && displayUnitPrice !== null ? formatCurrency(displayUnitPrice) : "";
                    const formattedSubtotal = lineSubtotal !== null ? formatCurrency(lineSubtotal) : "";
                    return (
                      <tr key={item.id}>
                        <td>{item.product.name}</td>
                        <td>{renderQuantity(item)}</td>
                        {showPricing ? <td style={{ textAlign: "right" }}>{formattedUnitPrice}</td> : null}
                        {showPricing ? <td style={{ textAlign: "right" }}>{formattedSubtotal}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {showPricing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  {isTVA ? (
                    <>
                      <div>Subtotal: {formatCurrency(receipt.total)}</div>
                      <div>VAT (11%): {formatCurrency(vatAmount)}</div>
                      <strong>Total incl. VAT: {formatCurrency(totalWithVat)}</strong>
                    </>
                  ) : (
                    <strong>Total: {formatCurrency(receipt.total)}</strong>
                  )}
                </div>
              ) : null}
            </>
          );
        })()}

        <section style={{ marginTop: 32, display: "flex", gap: 48, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ borderBottom: "1px solid #000", height: 32 }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>Customer signature</p>
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ borderBottom: "1px solid #000", height: 32 }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>Authorized by (office)</p>
          </div>
        </section>
      </article>
    </section>
  );
}

export default WorkerReceiptPrintPage;
