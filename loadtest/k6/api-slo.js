// API latency SLO test — validates the read-path NFRs:
//   • API response   < 200 ms (p95)   → employees / attendance / audit / cameras / notifications
//   • Dashboard       < 1000 ms (p95)  → monitoring dashboard
//   • Error rate      < 1%
//
// Run:  k6 run -e PASSWORD=... loadtest/k6/api-slo.js
// Tune: -e VUS=50 -e DURATION=2m -e BASE_URL=http://host:8000 -e EMAIL=...
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, login, authHeaders, ymd } from './lib/common.js'

const VUS = Number(__ENV.VUS || 20)
const DURATION = __ENV.DURATION || '1m'

export const options = {
  scenarios: {
    api: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{endpoint:employees}': ['p(95)<200'],
    'http_req_duration{endpoint:attendance}': ['p(95)<200'],
    'http_req_duration{endpoint:audit}': ['p(95)<200'],
    'http_req_duration{endpoint:cameras}': ['p(95)<200'],
    'http_req_duration{endpoint:notifications}': ['p(95)<200'],
    'http_req_duration{endpoint:dashboard}': ['p(95)<1000'],
  },
}

// The read endpoints under test. Built as a function so both setup() (warmup)
// and the iteration body share one source of truth.
function readEndpoints() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 7)
  return [
    { name: 'employees', path: '/api/v1/employees?per_page=50' },
    { name: 'audit', path: '/api/v1/audit-logs?per_page=100' },
    { name: 'cameras', path: '/api/v1/cameras?per_page=100' },
    { name: 'notifications', path: '/api/v1/notifications?per_page=50' },
    { name: 'dashboard', path: '/api/v1/monitoring/dashboard' },
    {
      name: 'attendance',
      path: `/api/v1/attendance?date_from=${ymd(from)}&date_to=${ymd(to)}&per_page=100`,
    },
  ]
}

export function setup() {
  const token = login()
  // Warm up each endpoint once before measurement: pays the one-time costs
  // (connection-pool fill, first query-plan compile, selectin priming) so the
  // measured p95 reflects steady state, not cold start. These requests are
  // intentionally UNTAGGED, so they don't land in the {endpoint:...} percentiles.
  const headers = authHeaders(token)
  for (const r of readEndpoints()) {
    http.get(`${BASE_URL}${r.path}`, { headers })
  }
  return { token }
}

export default function (data) {
  const headers = authHeaders(data.token)
  const reads = readEndpoints()

  // Each iteration exercises one random read so all endpoints get traffic.
  const pick = reads[Math.floor(Math.random() * reads.length)]
  const res = http.get(`${BASE_URL}${pick.path}`, { headers, tags: { endpoint: pick.name } })
  check(res, { [`${pick.name} → 200`]: (r) => r.status === 200 })
  sleep(0.5)
}
