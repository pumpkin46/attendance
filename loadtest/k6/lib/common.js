import http from 'k6/http'
import { check, fail } from 'k6'

// Shared config + auth for the k6 load tests.
// Override anything via env: BASE_URL, EMAIL, PASSWORD.
export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8000'
export const EMAIL = __ENV.EMAIL || 'admin@attendance.local'
export const PASSWORD = __ENV.PASSWORD || 'Loadtest123!'

/** Log in once and return the bearer token. Call from a k6 `setup()`. */
export function login() {
  if (!PASSWORD) {
    fail('Set PASSWORD (and EMAIL) env vars to authenticate — see loadtest/README.md')
  }
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } }
  )
  if (!check(res, { 'login → 200': (r) => r.status === 200 })) {
    fail(`Login failed (${res.status}): ${res.body}`)
  }
  return res.json('token')
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export function ymd(date) {
  return date.toISOString().slice(0, 10)
}
