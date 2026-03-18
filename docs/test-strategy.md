# Test Strategy

## Scope

This system handles operational and financial workflows. QA is structured around the highest-risk areas:

- authentication and role-based access
- receipts, invoices, payments, inventory, and payroll
- customer, supplier, and job-site master data
- reporting and export flows
- deployment and environment validation

## Test Pyramid

### 1. Backend integration tests

Backend API behavior is validated with `Vitest` + `Supertest` against a PostgreSQL test database.

Primary goals:

- validate permission boundaries
- validate input and failure paths
- validate cross-entity consistency
- prevent financial data drift across receipts, invoices, payments, inventory, and payroll

Current backend coverage includes:

- auth
- receipts
- invoices
- payments
- inventory
- payroll
- reports
- customers / suppliers / job sites
- RBAC boundaries

### 2. Frontend E2E tests

Frontend workflows are validated with `Playwright`.

Primary goals:

- verify authentication and shell navigation
- verify key business workflows from the user’s point of view
- verify permission-driven UI behavior
- catch regressions caused by integration between frontend and backend

Current E2E coverage includes:

- authentication
- dashboard and responsive navigation
- accessibility smoke checks on login and dashboard
- daily report PDF download
- invoice creation and mark-paid workflow
- restricted manager navigation
- worker-only navigation

### 3. Build and deployment validation

CI/CD quality gates also include:

- backend test database migrations
- frontend production build
- backend performance smoke against an authenticated reporting endpoint
- JMeter performance suite for heavier local and scheduled load validation
- security scans with Trivy and Gitleaks
- AWS deployment validation through staging infrastructure

## Risk-Based Priorities

The highest priority regression areas are:

1. user authentication and authorization
2. receipt creation and financial totals
3. invoice generation and payment propagation
4. customer and supplier balance integrity
5. inventory stock and payable calculations
6. payroll entry and payroll run settlement
7. reporting summaries used for operational decisions

## Release Gates

A change is release-ready when all of the following are true:

1. backend integration suite passes
2. frontend build passes
3. Playwright smoke and critical-path suite passes
4. security scans pass
5. staging deployment succeeds for infrastructure-affecting changes
6. no unresolved blocker exists in critical-path workflows

## CI Execution Model

QA execution is intentionally tiered by risk and runtime cost.

### Per pull request / merge gate

These checks run on pull requests and pushes to `main`:

- backend API integration tests
- frontend production build
- Playwright `@smoke` and `@critical` suites on Chromium
- security checks

These gates cover the workflows most likely to cause high-severity regressions:

- authentication
- shell/navigation integrity
- permission boundaries
- invoice creation and payment settlement
- daily report export

### Nightly regression

These checks run on a schedule or by manual dispatch:

- full Playwright regression across configured browsers
- accessibility-focused E2E checks
- backend performance smoke
- JMeter load validation when deeper throughput testing is needed

This keeps merge feedback fast while still exercising broader regression and non-functional coverage every day.

## Playwright Tiers

Current Playwright tagging:

- `@smoke`: auth entry, dashboard shell, responsive nav, base shell validation
- `@critical`: daily report download, invoice save/mark-paid, cross-module navigation, role-based access behavior
- `@nightly`: accessibility sweeps and any checks reserved for scheduled regression

## Performance Layers

The project now uses two performance layers:

- fast API smoke in CI for threshold enforcement
- JMeter for heavier concurrent load against authenticated endpoints

JMeter assets live under `performance/jmeter/` and are documented in `docs/performance-testing.md`.
The JMeter suite is wired into the nightly backend performance workflow only, not the PR merge path.

## Current Gaps

The QA baseline is strong, but these areas remain future improvements:

- broader accessibility coverage beyond smoke pages
- deeper performance / load testing beyond smoke thresholds
- visual regression checks
- coverage reporting and trend tracking
- synthetic post-deploy smoke checks in staging
