// Recognition latency test — validates the recognition NFR:
//   • Recognition processing < 300 ms (p95), measured two ways:
//       - http_req_duration{endpoint:identify} : end-to-end request time
//       - server_processing_ms                  : the engine's own `processing_ms`
//
// Uses the bundled face image by default; override with -e IMAGE_PATH=...
//   k6 run loadtest/k6/recognition.js
//   k6 run -e IMAGE_PATH=/abs/path/to/face.jpg loadtest/k6/recognition.js
// Relative IMAGE_PATH values resolve from this script's directory (loadtest/k6/),
// not your shell's CWD — that's a k6 open() rule, not a typo.
//
// NOTE: /recognition/identify is rate-limited (60/min per key by default). For a real
// throughput test set RATE_LIMIT_ENABLED=false on the server, or keep VUS low.
import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'
import { b64encode } from 'k6/encoding'
import { BASE_URL, login, authHeaders } from './lib/common.js'

// Defaults to the bundled asset, resolved relative to this script (loadtest/k6/).
const IMAGE_PATH = __ENV.IMAGE_PATH || '../assets/face.jpg'
// `open()` must run in init context.
const IMAGE_B64 = b64encode(open(IMAGE_PATH, 'b'))

// Default VUS=1: recognition is CPU-bound inference, so on a CPU-only host with
// few cores, concurrent requests just queue and the latency tail explodes —
// you'd measure oversubscription, not the engine. Raise VUS only on a GPU host
// (or a box with cores to spare). See "Recognition concurrency" in the README.
const VUS = Number(__ENV.VUS || 1)
const DURATION = __ENV.DURATION || '30s'

const processingMs = new Trend('server_processing_ms', true)

export const options = {
  scenarios: {
    recognition: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    'http_req_duration{endpoint:identify}': ['p(95)<300'],
    server_processing_ms: ['p(95)<300'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  },
}

export function setup() {
  return { token: login() }
}

export default function (data) {
  const body = JSON.stringify({
    image: IMAGE_B64,
    require_liveness: false,
    source: 'loadtest',
  })
  const res = http.post(`${BASE_URL}/api/v1/recognition/identify`, body, {
    headers: authHeaders(data.token),
    tags: { endpoint: 'identify' },
  })
  const ok = check(res, {
    'identify → 200': (r) => r.status === 200,
    'not rate-limited': (r) => r.status !== 429,
  })
  if (ok) {
    const ms = res.json('processing_ms')
    if (typeof ms === 'number') processingMs.add(ms)
  }
}
