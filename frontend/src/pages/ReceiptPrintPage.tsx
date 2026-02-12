import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchReceiptById } from "../api/receipts";
import { logReceiptPrint } from "../api/audit";
import type { Receipt } from "../types";
import { findDisplayOption } from "../constants/materials";
import { formatLebanonDate, formatLebanonDateTime } from "../utils/datetime";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

export function ReceiptPrintPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const loggedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const idParam = params.get("receiptId");
    if (!idParam) {
      setError("Missing receiptId parameter");
      setReceipt(null);
      return;
    }
    const numeric = Number(idParam);
    if (Number.isNaN(numeric)) {
      setError("Invalid receipt id");
      setReceipt(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchReceiptById(numeric)
      .then((data) => {
        if (!cancelled) {
          setReceipt(data);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.response?.data?.error ?? err?.message ?? "Unable to load receipt for printing.");
          setReceipt(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  useEffect(() => {
    loggedRef.current = false;
  }, [location.search]);

  useEffect(() => {
    if (receipt && !isLoading) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isLoading, receipt]);

  useEffect(() => {
    if (!receipt || loggedRef.current) return;
    loggedRef.current = true;
    logReceiptPrint(receipt.id).catch(() => {
      /* non-blocking */
    });
  }, [receipt]);

  if (error) {
    return (
      <section style={{ padding: 32 }}>
        <p className="error-text">{error}</p>
        <button className="secondary-button" onClick={() => navigate(-1)}>
          Go back
        </button>
      </section>
    );
  }

  if (isLoading || !receipt) {
    return (
      <section style={{ padding: 32 }}>
        <p>Preparing receipt…</p>
      </section>
    );
  }

  const customerName = receipt.customer ? receipt.customer.name : receipt.walkInName ?? "Walk-in";
  const hasPricedItems = receipt.items.some(
    (item) => item.unitPrice !== null && item.unitPrice !== undefined && item.unitPrice > 0,
  );
  const showPricing = receipt.isPaid && hasPricedItems;
  const isTVA = receipt.type === "TVA";
  const vatRate = 0.11;
  const vatAmount = Number(receipt.total) * vatRate;
  const totalWithVat = Number(receipt.total) + vatAmount;
  const renderQuantity = (item: Receipt["items"][number]) => {
    const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
    if (item.displayQuantity !== null && item.displayQuantity !== undefined) {
      return `${item.displayQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${
        preset?.label ?? item.product.unit ?? ""
      }`.trim();
    }
    if (preset && preset.toBaseFactor > 0) {
      const derived = item.quantity / preset.toBaseFactor;
      if (!Number.isNaN(derived)) {
        return `${derived.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${preset.label}`.trim();
      }
    }
    const baseUnit = item.product.unit ?? "";
    return `${item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${baseUnit ? ` ${baseUnit}` : ""}`;
  };

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
            font-size: 1.1rem;
            line-height: 1.45;
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

          .single-receipt {
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
          className="single-receipt"
          style={{
            background: cardBackground,
            padding: 20,
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
            width: "100%",
            maxWidth: "210mm",
          }}
        >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18,
            fontSize: "1.3rem",
          }}
        >
          <div>
            <h1 style={{ marginBottom: 6, fontSize: "2rem" }}>Receipt</h1>
            <p style={{ margin: 0, color: "var(--color-muted)", fontSize: "1.1rem" }}>
              Generated {formatLebanonDateTime(Date.now())}
            </p>
            <span style={{ display: "inline-block", marginTop: 10, fontWeight: 700 }}>
              Customer Copy
            </span>
          </div>
          <div style={{ textAlign: "right", fontSize: "1.3rem" }}>
            {isTVA ? (
              <>
                <div style={{ fontWeight: 700, fontSize: "1.8rem" }}>Bassam Nabih Al-Assaad</div>
                <div style={{ fontSize: "1.25rem" }}>Trade and Transport S.A.R.L</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: "2rem", letterSpacing: 1.2 }}>N.A.T</div>
                <div style={{ fontSize: "1.25rem" }}>مبيع جميع مواد البناء نقليات وحفريات</div>
              </>
            )}
          </div>
        </header>

        <section
          style={{
            marginBottom: 16,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
            fontSize: "1.3rem",
          }}
        >
          <div>
            <strong>Receipt #:</strong> {receipt.receiptNo ?? `#${receipt.id}`}
          </div>
          <div>
            <strong>Date:</strong> {formatLebanonDate(receipt.date)}
          </div>
          <div>
            <strong>Customer:</strong> {customerName}
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

        <table style={{ width: "100%", marginBottom: 16, fontSize: "1.2rem" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: "1.2rem" }}>Product</th>
              <th style={{ textAlign: "left", fontSize: "1.2rem" }}>Quantity</th>
              {showPricing ? <th style={{ textAlign: "right", fontSize: "1.2rem" }}>Unit price</th> : null}
              {showPricing ? <th style={{ textAlign: "right", fontSize: "1.2rem" }}>Subtotal</th> : null}
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => {
              const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
              const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined && Number(item.unitPrice) > 0;
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

        <section style={{ marginTop: 24, display: "flex", gap: 24, fontSize: "1.2rem" }}>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ borderBottom: "1px solid #000", height: 32 }} />
            <p style={{ marginTop: 8 }}>Customer signature</p>
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ borderBottom: "1px solid #000", height: 32 }} />
            <p style={{ marginTop: 8 }}>Authorized by (office)</p>
          </div>
        </section>
        </article>
    </section>
  );
}

export default ReceiptPrintPage;
