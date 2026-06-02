import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createKioskClient } from '../api/kioskClient'
import { useWebcam } from '../hooks/useWebcam'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
type Step = 'welcome' | 'lookup' | 'register' | 'enroll' | 'complete' | 'error'

interface KioskConfig {
  kiosk: { name: string; allow_walk_in: boolean; require_host: boolean; require_liveness: boolean }
}

interface VisitorInfo {
  id: number
  name: string
  company?: string
  check_in_code?: string
  badge_number?: string
  face_registered: boolean
  status: string
  host?: { first_name: string; last_name: string }
}

interface Host {
  id: number
  first_name: string
  last_name: string
  employee_code: string
}

export default function VisitorKioskPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? localStorage.getItem('visitor_kiosk_token') ?? ''
  const kioskApi = useMemo(() => (token ? createKioskClient(token) : null), [token])

  const [step, setStep] = useState<Step>('welcome')
  const [config, setConfig] = useState<KioskConfig | null>(null)
  const [visitor, setVisitor] = useState<VisitorInfo | null>(null)
  const [lookupQuery, setLookupQuery] = useState('')
  const [hosts, setHosts] = useState<Host[]>([])
  const [hostSearch, setHostSearch] = useState('')
  const [registerForm, setRegisterForm] = useState({
    name: '',
    company: '',
    phone: '',
    purpose: '',
    host_employee_id: '',
  })
  const [message, setMessage] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const { videoRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!token || !kioskApi) {
      setStep('error')
      setMessage('Missing kiosk token. Add ?token=... to the URL or configure the device.')
      return
    }
    localStorage.setItem('visitor_kiosk_token', token)
    kioskApi
      .get<KioskConfig>('/kiosk/visitor/config')
      .then((r) => setConfig(r.data))
      .catch(() => {
        setStep('error')
        setMessage('Invalid kiosk token.')
      })

    heartbeatRef.current = setInterval(() => {
      kioskApi.post('/kiosk/visitor/heartbeat').catch(() => {})
    }, 60_000)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [token, kioskApi])

  useEffect(() => {
    if (!kioskApi || hostSearch.length < 2) return
    const t = setTimeout(() => {
      kioskApi.get<Host[]>('/kiosk/visitor/hosts', { params: { search: hostSearch } }).then((r) => setHosts(r.data))
    }, 300)
    return () => clearTimeout(t)
  }, [hostSearch, kioskApi])

  const runLookup = async () => {
    if (!kioskApi) return
    try {
      const { data } = await kioskApi.post<{ found: boolean; visitor?: VisitorInfo }>('/kiosk/visitor/lookup', {
        query: lookupQuery,
      })
      if (!data.found || !data.visitor) {
        setMessage('No appointment found. Try walk-in registration.')
        return
      }
      setVisitor(data.visitor)
      setStep(data.visitor.face_registered ? 'complete' : 'enroll')
      if (data.visitor.face_registered) await finishCheckIn(data.visitor.id)
    } catch {
      setMessage('Lookup failed.')
    }
  }

  const runRegister = async () => {
    if (!kioskApi) return
    try {
      const { data } = await kioskApi.post<{ visitor: VisitorInfo }>('/kiosk/visitor/register', {
        ...registerForm,
        host_employee_id: registerForm.host_employee_id ? Number(registerForm.host_employee_id) : null,
      })
      setVisitor(data.visitor)
      setStep('enroll')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Registration failed.'
      setMessage(msg)
    }
  }

  const finishCheckIn = async (visitorId: number) => {
    if (!kioskApi) return
    const { data } = await kioskApi.post<{ visitor: VisitorInfo }>(`/kiosk/visitor/visitors/${visitorId}/check-in`)
    setVisitor(data.visitor)
    setStep('complete')
  }

  const enrollAndCheckIn = useCallback(async () => {
    if (!kioskApi || !visitor) return
    setEnrolling(true)
    try {
      const frame = captureFrame(640)
      if (!frame) {
        setMessage('Could not capture photo.')
        return
      }
      await kioskApi.post(`/kiosk/visitor/visitors/${visitor.id}/enroll-face`, { image: frame })
      await finishCheckIn(visitor.id)
    } catch {
      setMessage('Face enrollment failed. Please try again.')
    } finally {
      setEnrolling(false)
    }
  }, [kioskApi, visitor, captureFrame])

  const reset = () => {
    setVisitor(null)
    setLookupQuery('')
    setRegisterForm({ name: '', company: '', phone: '', purpose: '', host_employee_id: '' })
    setMessage('')
    stop()
    setStep('welcome')
  }

  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-slate-200">
        <div>
          <h1 className="text-2xl font-semibold text-red-400">Kiosk unavailable</h1>
          <p className="mt-4 text-slate-400">{message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100">
      <header className="border-b border-slate-800 px-8 py-6 text-center">
        <h1 className="text-2xl font-semibold">{config?.kiosk.name ?? 'Visitor Check-In'}</h1>
        <p className="mt-1 text-slate-400">Autonomous visitor kiosk</p>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center p-8">
        {message && <p className="mb-4 rounded-lg bg-amber-900/50 px-4 py-2 text-sm text-amber-200">{message}</p>}

        {step === 'welcome' && (
          <Card className="space-y-4 text-center">
            <p className="text-lg">Welcome. How can we help you?</p>
            <Button className="w-full" onClick={() => setStep('lookup')}>
              I have an appointment
            </Button>
            {config?.kiosk.allow_walk_in && (
              <Button className="w-full" variant="ghost" onClick={() => setStep('register')}>
                Walk-in visitor
              </Button>
            )}
          </Card>
        )}

        {step === 'lookup' && (
          <Card className="space-y-4">
            <Label>
              Visit code or phone
              <Input
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="e.g. ABC123 or +1..."
                autoFocus
              />
            </Label>
            <Button className="w-full" onClick={runLookup}>
              Find appointment
            </Button>
            <Button variant="ghost" className="w-full" onClick={reset}>
              Back
            </Button>
          </Card>
        )}

        {step === 'register' && (
          <Card className="space-y-4">
            <Label>
              Full name *
              <Input
                value={registerForm.name}
                onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
              />
            </Label>
            <Label>
              Company
              <Input
                value={registerForm.company}
                onChange={(e) => setRegisterForm({ ...registerForm, company: e.target.value })}
              />
            </Label>
            <Label>
              Phone
              <Input
                value={registerForm.phone}
                onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
              />
            </Label>
            <Label>
              Purpose
              <Input
                value={registerForm.purpose}
                onChange={(e) => setRegisterForm({ ...registerForm, purpose: e.target.value })}
              />
            </Label>
            {config?.kiosk.require_host && (
              <>
                <Label>
                  Host (search)
                  <Input value={hostSearch} onChange={(e) => setHostSearch(e.target.value)} />
                </Label>
                <select
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                  value={registerForm.host_employee_id}
                  onChange={(e) => setRegisterForm({ ...registerForm, host_employee_id: e.target.value })}
                >
                  <option value="">Select host</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.first_name} {h.last_name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button className="w-full" onClick={runRegister} disabled={!registerForm.name}>
              Continue
            </Button>
            <Button variant="ghost" className="w-full" onClick={reset}>
              Back
            </Button>
          </Card>
        )}

        {step === 'enroll' && visitor && (
          <Card className="space-y-4 text-center">
            <p>Hello, {visitor.name}. Please look at the camera for your visitor badge photo.</p>
            <div className="relative mx-auto aspect-[4/3] max-w-sm overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
            </div>
            {camError && <p className="text-sm text-red-400">{camError}</p>}
            {!active ? (
              <Button className="w-full" onClick={() => start()}>
                Start camera
              </Button>
            ) : (
              <Button className="w-full" onClick={enrollAndCheckIn} disabled={enrolling}>
                {enrolling ? 'Processing…' : 'Capture & check in'}
              </Button>
            )}
          </Card>
        )}

        {step === 'complete' && visitor && (
          <Card className="space-y-6 text-center">
            <div className="text-6xl">✓</div>
            <h2 className="text-xl font-semibold text-green-400">You&apos;re checked in</h2>
            <p className="text-2xl font-bold">{visitor.name}</p>
            {visitor.badge_number && (
              <div className="mx-auto rounded-xl border-2 border-dashed border-blue-500 bg-blue-950/50 px-8 py-6">
                <p className="text-xs uppercase tracking-wider text-slate-400">Visitor badge</p>
                <p className="text-3xl font-mono font-bold text-blue-300">{visitor.badge_number}</p>
              </div>
            )}
            {visitor.host && (
              <p className="text-slate-400">
                Host: {visitor.host.first_name} {visitor.host.last_name}
              </p>
            )}
            <Button className="w-full" onClick={reset}>
              Done — next visitor
            </Button>
          </Card>
        )}
      </main>
    </div>
  )
}
