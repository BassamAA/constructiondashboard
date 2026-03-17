# Regression Checklist

Use this checklist for release candidates, infrastructure changes, and risky business-logic updates.

## Core Access

- login succeeds for admin
- restricted manager account hides unauthorized modules
- worker account only sees worker-specific flows
- logout clears the session and returns to login

## Receipts and Invoicing

- create a receipt successfully
- receipt totals and paid status update correctly
- invoice preview builds from unpaid receipts
- saved invoice appears in the invoice list
- marking an invoice paid settles linked receipt balances

## Payments and Financial Consistency

- customer payment allocates against open receipts
- supplier payment allocates against unpaid purchases
- payment list reflects the new transaction
- receivables / payables views reflect updated balances

## Inventory and Production

- purchase entry updates stock quantity
- production entry updates output and material consumption
- deleting or editing an inventory entry keeps stock consistent
- payables report reflects unpaid inventory purchases

## Payroll

- salary payroll entry can be created
- payroll run can be generated and debited
- payroll payment appears in finance/payment views

## Reporting

- dashboard loads
- reports summary loads without API errors
- daily report loads and PDF export works

## Operational Gates

- backend integration tests pass
- frontend build passes
- Playwright smoke suite passes
- accessibility smoke checks pass
- backend performance smoke passes
- security scans pass
- staging deploy succeeds if deployment or infrastructure changed
