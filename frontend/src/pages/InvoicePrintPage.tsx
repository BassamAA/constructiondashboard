import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createInvoicePreview, fetchInvoiceById } from "../api/invoices";
import type { InvoicePreview, InvoiceRecord } from "../types";
import { findDisplayOption } from "../constants/materials";
import { logInvoicePrint } from "../api/audit";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

function useQueryParams() {
  return new URLSearchParams(useLocation().search);
}

export function InvoicePrintPage() {
  const params = useQueryParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const loggedRef = useRef(false);
  const totalsOnly = params.get("totals") === "1";

  const invoiceIdParam = params.get("invoiceId");
  const invoiceId = useMemo(() => {
    if (!invoiceIdParam) return null;
    const parsed = Number(invoiceIdParam);
    if (Number.isNaN(parsed)) {
      setError("Invalid invoice id");
      return null;
    }
    return parsed;
  }, [invoiceIdParam]);

  const previewPayload = useMemo(() => {
    if (invoiceId) {
      return null;
    }
    const customerIdParam = params.get("customerId");
    if (!customerIdParam) {
      setError("Missing customerId parameter");
      return null;
    }
    const receiptIds = params
      .getAll("receiptId")
      .map((id) => Number(id))
      .filter((id) => !Number.isNaN(id));
    const amountParam = params.get("amount");
    const includePaid = params.get("includePaid") === "1";

    const base = { customerId: Number(customerIdParam), includePaid };

    if (Number.isNaN(base.customerId)) {
      setError("Invalid customer id");
      return null;
    }

    if (receiptIds.length > 0) {
      return { ...base, payload: { receiptIds, includePaid } };
    }
    if (amountParam) {
      const parsed = Number(amountParam);
      if (Number.isNaN(parsed) || parsed <= 0) {
        setError("Invalid amount parameter");
        return null;
      }
      return { ...base, payload: { amount: parsed, includePaid } };
    }

    setError("Provide receiptId values or an amount");
    return null;
  }, [invoiceId, params]);

  const { data, isLoading } = useQuery<InvoicePreview | InvoiceRecord | undefined>({
    queryKey: invoiceId
      ? ["invoice-print-by-id", invoiceId]
      : previewPayload
      ? ["invoice-print", previewPayload.customerId, previewPayload.payload]
      : ["invoice-print"],
    queryFn: async () => {
      if (invoiceId) {
        return fetchInvoiceById(invoiceId);
      }
      if (!previewPayload) return undefined;
      return createInvoicePreview(previewPayload.customerId, previewPayload.payload);
    },
    enabled: Boolean(invoiceId) || Boolean(previewPayload),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    loggedRef.current = false;
  }, [invoiceId, previewPayload]);

  useEffect(() => {
    if (!isLoading && data) {
      if (!loggedRef.current) {
        loggedRef.current = true;
        logInvoicePrint({
          customerId: data.customer.id,
          receiptIds: data.invoice.receipts.map((receipt) => receipt.id),
        }).catch(() => {
          /* ignore */
        });
      }
      const timer = setTimeout(() => {
        window.print();
      }, 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isLoading, data]);

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

  if (isLoading || !data) {
    return (
      <section style={{ padding: 32 }}>
        <p>Preparing invoice…</p>
      </section>
    );
  }

  return (
    <section style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <style>{`
        @media print {
          body {
            background: #fff;
          }
        }
      `}</style>
      <InvoiceCopySection data={data} totalsOnly={totalsOnly} />
    </section>
  );
}

function InvoiceCopySection({ data, totalsOnly }: { data: InvoicePreview; totalsOnly: boolean }) {
  const { customer, invoice, jobSite } = data;
  const receiptType = invoice.receiptType ?? invoice.receipts[0]?.type ?? "NORMAL";
  const isTvaInvoice = receiptType === "TVA";
  const vatRate = isTvaInvoice ? invoice.vatRate ?? 0.11 : 0;
  const computedVatAmount = isTvaInvoice
    ? invoice.vatAmount ?? Math.round(invoice.subtotal * vatRate * 100) / 100
    : 0;
  const totalWithVat = isTvaInvoice
    ? invoice.totalWithVat ?? invoice.subtotal + computedVatAmount
    : invoice.totalWithVat ?? invoice.subtotal;
  const outstandingAmount =
    invoice.outstanding ??
    Math.max(totalWithVat - (invoice.amountPaid ?? 0), 0);
  const oldBalance = invoice.oldBalance ?? 0;

  const formatLineItem = (
    item: InvoicePreview["invoice"]["receipts"][number]["items"][number],
  ): string => {
    const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
    const displayQuantity = (() => {
      if (item.displayQuantity !== null && item.displayQuantity !== undefined) {
        return item.displayQuantity;
      }
      if (preset && preset.toBaseFactor > 0) {
        return item.quantity / preset.toBaseFactor;
      }
      return undefined;
    })();

    const quantityText = (() => {
      if (preset && displayQuantity !== undefined && !Number.isNaN(displayQuantity)) {
        return `${displayQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${preset.label}`;
      }
      const baseUnit = item.product?.unit ?? "";
      return `${item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${baseUnit ? ` ${baseUnit}` : ""}`;
    })();

    const hasPrice = item.unitPrice !== null && item.unitPrice !== undefined;
    const baseUnitPrice = hasPrice ? item.unitPrice! : null;
    const displayUnitPrice =
      baseUnitPrice !== null && preset && preset.toBaseFactor > 0
        ? baseUnitPrice * preset.toBaseFactor
        : baseUnitPrice;

    if (!hasPrice || displayUnitPrice === null) {
      return `${item.product?.name ?? "Item"} – ${quantityText} (price pending)`;
    }

    return `${item.product?.name ?? "Item"} – ${quantityText} × ${formatCurrency(displayUnitPrice)}`;
  };

  const aggregatedItems = useMemo(() => {
    if (!totalsOnly) return [];
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        quantity: number;
        amount: number;
        hasPendingPricing: boolean;
        unit: string;
        presetLabel?: string;
        presetFactor?: number;
      }
    >();
    invoice.receipts.forEach((receipt) => {
      receipt.items.forEach((item) => {
        const key = `${item.productId ?? "custom"}-${item.displayUnit ?? "base"}`;
        if (!map.has(key)) {
          const preset = findDisplayOption(item.product, item.displayUnit ?? undefined);
          map.set(key, {
            key,
            name: item.product?.name ?? "Item",
            quantity: 0,
            amount: 0,
            hasPendingPricing: false,
            unit: item.product?.unit ?? "",
            presetLabel: preset?.label,
            presetFactor: preset?.toBaseFactor && preset.toBaseFactor > 0 ? preset.toBaseFactor : undefined,
          });
        }
        const entry = map.get(key)!;
        entry.quantity += item.quantity;
        if (item.unitPrice === null || item.unitPrice === undefined) {
          entry.hasPendingPricing = true;
        } else {
          entry.amount += item.unitPrice * item.quantity;
        }
      });
    });
    return Array.from(map.values()).map((entry) => {
      const quantityText =
        entry.presetLabel && entry.presetFactor
          ? `${(entry.quantity / entry.presetFactor).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })} ${entry.presetLabel}`
          : `${entry.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${
              entry.unit ? ` ${entry.unit}` : ""
            }`;
      return {
        ...entry,
        quantityText,
      };
    });
  }, [invoice, totalsOnly]);

  return (
    <article
      className="invoice-copy"
      style={{
        background: "#fff",
        padding: "24px",
        marginBottom: "32px",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Invoice</h1>
          <p style={{ margin: 0, color: "var(--color-muted)" }}>
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          {isTvaInvoice ? (
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

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24, gap: 32, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginBottom: 8 }}>Bill to</h3>
          <div style={{ fontWeight: 600 }}>{customer.name}</div>
          {customer.contactName ? <div>{customer.contactName}</div> : null}
          {customer.email ? <div>{customer.email}</div> : null}
          {customer.phone ? <div>{customer.phone}</div> : null}
          {jobSite ? (
            <div style={{ marginTop: 8, fontStyle: "italic", color: "var(--color-muted)" }}>
              Job site: {jobSite.name}
            </div>
          ) : null}
        </div>
        <div style={{ flexShrink: 0 }}>
          <table>
            <tbody>
              <tr>
                <th style={{ borderBottom: "none", textTransform: "none", color: "var(--color-muted)" }}>Subtotal</th>
                <td style={{ borderBottom: "none" }}>{formatCurrency(invoice.subtotal)}</td>
              </tr>
              {isTvaInvoice ? (
                <tr>
                  <th style={{ borderBottom: "none", textTransform: "none", color: "var(--color-muted)" }}>
                    VAT ({(vatRate * 100).toFixed(0)}%)
                  </th>
                  <td style={{ borderBottom: "none" }}>{formatCurrency(computedVatAmount)}</td>
                </tr>
              ) : null}
              <tr>
                <th style={{ borderBottom: "none", textTransform: "none", color: "var(--color-muted)" }}>
                  Total (incl. VAT)
                </th>
                <td style={{ borderBottom: "none" }}>{formatCurrency(totalWithVat)}</td>
              </tr>
              <tr>
                <th style={{ textTransform: "none", color: "var(--color-text)" }}>Outstanding</th>
                <td>
                  <strong>{formatCurrency(outstandingAmount)}</strong>
                </td>
              </tr>
              <tr>
                <th style={{ textTransform: "none", color: "var(--color-text)" }}>
                  Old balance (other receipts)
                </th>
                <td>
                  <strong>{formatCurrency(oldBalance)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {totalsOnly ? (
        <table style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Total quantity</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {aggregatedItems.map((item) => (
              <tr key={item.key}>
                <td>{item.name}</td>
                <td>{item.quantityText}</td>
                <td>
                  {item.hasPendingPricing ? "Pending pricing" : formatCurrency(item.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>
                Old balance (other receipts)
              </td>
              <td style={{ fontWeight: 600 }}>{formatCurrency(oldBalance)}</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ textAlign: "right", fontWeight: 600 }}>
                Outstanding balance
              </td>
              <td style={{ fontWeight: 600 }}>{formatCurrency(outstandingAmount)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt #</th>
              <th>Items</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoice.receipts.map((receipt) => {
              const hasPendingPricing = receipt.items.some(
                (item) => item.unitPrice === null || item.unitPrice === undefined,
              );
              const outstanding = hasPendingPricing
                ? null
                : Math.max(0, Number(receipt.total) - Number(receipt.amountPaid ?? 0));

              return (
                <tr key={receipt.id}>
                  <td>{new Date(receipt.date).toLocaleDateString()}</td>
                  <td>{receipt.receiptNo ?? `#${receipt.id}`}</td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {receipt.items.map((item) => (
                        <li key={item.id}>{formatLineItem(item)}</li>
                      ))}
                    </ul>
                  </td>
                  <td>{outstanding === null ? "Pending pricing" : formatCurrency(outstanding)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>
                Outstanding balance
              </td>
              <td style={{ fontWeight: 600 }}>{formatCurrency(outstandingAmount)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <section style={{ marginTop: 24, display: "flex", gap: 48, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ borderBottom: "1px solid #000", height: 32 }} />
          <p style={{ marginTop: 8, fontSize: 14 }}>Customer signature</p>
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ borderBottom: "1px solid #000", height: 32 }} />
          <p style={{ marginTop: 8, fontSize: 14 }}>Authorized by (office)</p>
        </div>
      </section>

      <footer style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="secondary-button" onClick={() => window.print()}>
          Print again
        </button>
      </footer>
    </article>
  );
}

export default InvoicePrintPage;
