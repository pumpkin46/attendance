// Recognition latency test — validates the recognition NFR:
//   • Recognition processing < 300 ms (p95), measured two ways:
//       - http_req_duration{endpoint:identify} : end-to-end request time
//       - server_processing_ms                  : the engine's own `processing_ms`
//
// Requires a face image:
//   k6 run -e PASSWORD=... -e IMAGE_PATH=./loadtest/assets/face.jpg loadtest/k6/recognition.js
//
// NOTE: /recognition/identify is rate-limited (60/min per key by default). For a real
// throughput test set RATE_LIMIT_ENABLED=false on the server, or keep VUS low.
import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'
import { b64encode } from 'k6/encoding'
import { BASE_URL, login, authHeaders } from './lib/common.js'

const IMAGE_PATH = __ENV.IMAGE_PATH || ''
// `open()` must run in init context; guard so an empty path doesn't throw here.
const IMAGE_B64 = IMAGE_PATH ? b64encode(open(IMAGE_PATH, 'b')) : ''

const VUS = Number(__ENV.VUS || 5)
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
  if (!IMAGE_B64) {
    throw new Error('Set IMAGE_PATH to a JPEG/PNG containing a face — see loadtest/README.md')
  }
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
