# Performance Testing

This repository includes two performance layers:

- `backend/scripts/perf-smoke.js` for fast threshold checks suitable for CI
- JMeter for heavier local or scheduled load testing

## JMeter Suite

The JMeter test plan lives at:

- `performance/jmeter/reports-summary-load.jmx`

This suite:

- logs in once per virtual user
- stores the session cookie with JMeter's cookie manager
- repeatedly calls `GET /reports/summary`
- records latency and response outcomes into a JTL result file and HTML report

## Prerequisites

1. Install Apache JMeter locally.
2. Start the backend locally on `http://localhost:4000`.
3. Provide a valid user that can log in.

Optional:

4. Provide `BOOTSTRAP_TOKEN` if you want the wrapper to attempt admin bootstrap before the JMeter run.

## Run The Suite

From the repository root:

```bash
chmod +x performance/jmeter/run-reports-summary-load.sh
JMETER_USERNAME=e2e-admin@example.com \
JMETER_PASSWORD='your-password' \
./performance/jmeter/run-reports-summary-load.sh
```

Default runtime settings:

- `10` threads
- `10` second ramp-up
- `20` loops per user

## Override Load Settings

Example:

```bash
THREADS=25 \
RAMP_UP=15 \
LOOPS=40 \
HOST=localhost \
PORT=4000 \
JMETER_USERNAME=e2e-admin@example.com \
JMETER_PASSWORD='your-password' \
./performance/jmeter/run-reports-summary-load.sh
```

If your local backend allows bootstrap and you want the wrapper to create the admin user when the database is empty:

```bash
JMETER_USERNAME=e2e-admin@example.com \
JMETER_PASSWORD='Password123!' \
BOOTSTRAP_TOKEN=bootstrap-secret-001 \
./performance/jmeter/run-reports-summary-load.sh
```

You can also point it at staging:

```bash
PROTOCOL=https \
HOST=your-staging-host.example.com \
PORT=443 \
JMETER_USERNAME=your-user@example.com \
JMETER_PASSWORD=your-password \
./performance/jmeter/run-reports-summary-load.sh
```

## Credential Validation

The wrapper now performs a preflight login check before starting JMeter.

If login fails, the script exits immediately and prints the backend response instead of running a full load test with invalid credentials.

## Results

Generated artifacts are written to:

- `performance/jmeter/results/reports-summary-load/results.jtl`
- `performance/jmeter/results/reports-summary-load/html/`

The HTML folder can be opened directly in a browser after the run completes.

## Recommended Usage

Use JMeter for:

- larger local validation before risky releases
- comparing endpoint behavior under higher concurrency
- scheduled environment checks beyond lightweight CI smoke

Keep the Node performance smoke as the merge-path quality gate because it is faster and easier to run in CI.

## Nightly GitHub Actions Usage

JMeter is wired into the nightly backend performance workflow only:

- `.github/workflows/backend-performance-smoke.yml`

That workflow:

- runs on a GitHub-hosted runner
- starts a temporary local Postgres service and backend process
- runs the fast Node performance smoke
- runs the JMeter load suite afterward
- uploads the JTL and HTML artifacts

This does not create AWS cost by itself because it does not target AWS infrastructure unless you explicitly change the workflow to point JMeter at an AWS-hosted environment.
