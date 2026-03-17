#!/usr/bin/env node

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const PERF_ENDPOINT = process.env.PERF_ENDPOINT || '/reports/summary';
const PERF_REQUESTS = Number(process.env.PERF_REQUESTS || 30);
const PERF_CONCURRENCY = Number(process.env.PERF_CONCURRENCY || 5);
const PERF_P95_MS = Number(process.env.PERF_P95_MS || 1500);
const PERF_AVG_MS = Number(process.env.PERF_AVG_MS || 800);
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN;
const PERF_EMAIL = process.env.PERF_EMAIL || `perf-admin-${Date.now()}@example.com`;
const PERF_PASSWORD = process.env.PERF_PASSWORD || 'Password123!';

if (!ADMIN_BOOTSTRAP_TOKEN) {
  console.error('ADMIN_BOOTSTRAP_TOKEN must be set for performance smoke.');
  process.exit(1);
}

async function bootstrapAdmin() {
  const response = await fetch(`${BACKEND_URL}/auth/bootstrap`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bootstrap-token': ADMIN_BOOTSTRAP_TOKEN,
    },
    body: JSON.stringify({
      email: PERF_EMAIL,
      password: PERF_PASSWORD,
      name: 'Perf Smoke Admin',
    }),
  });

  if (response.ok) {
    return;
  }

  const payload = await response.json().catch(() => ({}));
  if (response.status === 400 && payload?.error === 'Users already exist. Use the normal login flow.') {
    return;
  }

  throw new Error(`Bootstrap failed: ${response.status} ${JSON.stringify(payload)}`);
}

async function login() {
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: PERF_EMAIL,
      password: PERF_PASSWORD,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Login failed: ${response.status} ${payload}`);
  }

  const rawCookie = response.headers.get('set-cookie');
  if (!rawCookie) {
    throw new Error('Login succeeded without session cookie.');
  }

  return rawCookie.split(';')[0];
}

async function timedRequest(cookie) {
  const startedAt = performance.now();
  const response = await fetch(`${BACKEND_URL}${PERF_ENDPOINT}`, {
    headers: {
      cookie,
    },
  });
  const duration = performance.now() - startedAt;
  return { ok: response.ok, status: response.status, duration };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function runSmoke(cookie) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < PERF_REQUESTS) {
      nextIndex += 1;
      results.push(await timedRequest(cookie));
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(PERF_CONCURRENCY, PERF_REQUESTS)) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}

async function main() {
  await bootstrapAdmin();
  const cookie = await login();

  for (let i = 0; i < 3; i += 1) {
    await timedRequest(cookie);
  }

  const results = await runSmoke(cookie);
  const failures = results.filter((result) => !result.ok);
  const latencies = results.map((result) => result.duration);
  const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const p95 = percentile(latencies, 95);

  console.log(
    JSON.stringify(
      {
        endpoint: PERF_ENDPOINT,
        requests: PERF_REQUESTS,
        concurrency: PERF_CONCURRENCY,
        failures: failures.length,
        averageMs: Number(avg.toFixed(2)),
        p95Ms: Number(p95.toFixed(2)),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    const sample = failures[0];
    throw new Error(`Performance smoke saw ${failures.length} non-2xx responses. Sample status: ${sample.status}`);
  }

  if (avg > PERF_AVG_MS) {
    throw new Error(`Average latency ${avg.toFixed(2)}ms exceeded threshold ${PERF_AVG_MS}ms`);
  }

  if (p95 > PERF_P95_MS) {
    throw new Error(`P95 latency ${p95.toFixed(2)}ms exceeded threshold ${PERF_P95_MS}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
