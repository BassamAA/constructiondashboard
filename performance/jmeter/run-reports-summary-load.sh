#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results/reports-summary-load"
PLAN_PATH="${SCRIPT_DIR}/reports-summary-load.jmx"

mkdir -p "${RESULTS_DIR}"
rm -rf "${RESULTS_DIR}/html"
rm -f "${RESULTS_DIR}/results.jtl" "${RESULTS_DIR}/login-response.json" "${RESULTS_DIR}/bootstrap-response.json" "${RESULTS_DIR}/preflight-cookies.txt"

JMETER_BIN="${JMETER_BIN:-jmeter}"
HOST="${HOST:-localhost}"
PORT="${PORT:-4000}"
PROTOCOL="${PROTOCOL:-http}"
THREADS="${THREADS:-10}"
RAMP_UP="${RAMP_UP:-10}"
LOOPS="${LOOPS:-20}"
JMETER_USERNAME="${JMETER_USERNAME:-}"
JMETER_PASSWORD="${JMETER_PASSWORD:-}"
TARGET_PATH="${TARGET_PATH:-/reports/summary}"
BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-}"
BOOTSTRAP_NAME="${BOOTSTRAP_NAME:-JMeter Admin}"
BASE_URL="${PROTOCOL}://${HOST}:${PORT}"
COOKIE_JAR="${RESULTS_DIR}/preflight-cookies.txt"

if [[ -z "${JMETER_USERNAME}" || -z "${JMETER_PASSWORD}" ]]; then
  echo "JMETER_USERNAME and JMETER_PASSWORD must be set for the JMeter suite." >&2
  echo "Example:" >&2
  echo "  JMETER_USERNAME=e2e-admin@example.com JMETER_PASSWORD='Password123!' ./performance/jmeter/run-reports-summary-load.sh" >&2
  exit 1
fi

if [[ -n "${BOOTSTRAP_TOKEN}" ]]; then
  bootstrap_body=$(cat <<EOF
{"email":"${JMETER_USERNAME}","password":"${JMETER_PASSWORD}","name":"${BOOTSTRAP_NAME}"}
EOF
)

  bootstrap_response_file="${RESULTS_DIR}/bootstrap-response.json"
  bootstrap_status=$(
    curl -sS -o "${bootstrap_response_file}" -w "%{http_code}" \
      -X POST "${BASE_URL}/auth/bootstrap" \
      -H "Content-Type: application/json" \
      -H "x-bootstrap-token: ${BOOTSTRAP_TOKEN}" \
      -d "${bootstrap_body}"
  )

  if [[ "${bootstrap_status}" != "200" && "${bootstrap_status}" != "201" ]]; then
    if ! grep -q 'Users already exist. Use the normal login flow.' "${bootstrap_response_file}"; then
      echo "Bootstrap failed with status ${bootstrap_status}." >&2
      cat "${bootstrap_response_file}" >&2
      exit 1
    fi
  fi
fi

login_body=$(cat <<EOF
{"email":"${JMETER_USERNAME}","password":"${JMETER_PASSWORD}"}
EOF
)

login_response_file="${RESULTS_DIR}/login-response.json"
login_status=$(
  curl -sS -c "${COOKIE_JAR}" -o "${login_response_file}" -w "%{http_code}" \
    -X POST "${BASE_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "${login_body}"
)

if [[ "${login_status}" != "200" ]]; then
  echo "Preflight login failed with status ${login_status}." >&2
  cat "${login_response_file}" >&2
  exit 1
fi

"${JMETER_BIN}" \
  -n \
  -t "${PLAN_PATH}" \
  -l "${RESULTS_DIR}/results.jtl" \
  -e \
  -o "${RESULTS_DIR}/html" \
  -Jhost="${HOST}" \
  -Jport="${PORT}" \
  -Jprotocol="${PROTOCOL}" \
  -Jthreads="${THREADS}" \
  -Jramp_up="${RAMP_UP}" \
  -Jloops="${LOOPS}" \
  -Jusername="${JMETER_USERNAME}" \
  -Jpassword="${JMETER_PASSWORD}" \
  -Jtarget_path="${TARGET_PATH}"

echo "JMeter results saved to ${RESULTS_DIR}"
