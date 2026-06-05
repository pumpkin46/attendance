import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Badge } from '@/shared/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useWebcam } from '@/shared/hooks/useWebcam'
import {
  useAccessConfig,
  useAccessPoints,
  useCreateAccessPoint,
  useExecuteAccessAction,
  useFaceGrant,
} from '@/features/access/api/queries'
import type { FaceGrantResult } from '@/features/access/types'

export default function AccessControlPage() {
  const { data: pointsData } = useAccessPoints()
  const { data: config } = useAccessConfig()
  const createAccessPoint = useCreateAccessPoint()
  const executeAction = useExecuteAccessAction()
  const faceGrant = useFaceGrant()

  const points = Array.isArray(pointsData) ? pointsData : (pointsData?.data ?? [])

  const [faceGrantPoint, setFaceGrantPoint] = useState<number | null>(null)
  const [grantResult, setGrantResult] = useState<FaceGrantResult | null>(null)
  const { videoRef, active, start, stop, captureFrame } = useWebcam()
  const [form, setForm] = useState({
    organization_id: '1',
    name: '',
    device_type: 'door',
    default_action: 'unlock_door',
    controller_url: '',
    camera_id: '',
  })

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    createAccessPoint.mutate({
      organization_id: Number(form.organization_id),
      name: form.name,
      device_type: form.device_type,
      default_action: form.default_action,
      camera_id: form.camera_id ? Number(form.camera_id) : null,
      controller_url: form.controller_url || null,
    })
  }

  const execute = (id: number, action: string) => {
    executeAction.mutate({ id, action })
  }

  const openFaceGrant = async (id: number) => {
    setFaceGrantPoint(id)
    setGrantResult(null)
    await start()
  }

  const closeFaceGrant = () => {
    stop()
    setFaceGrantPoint(null)
    setGrantResult(null)
  }

  const runFaceGrant = async () => {
    if (!faceGrantPoint) return
    const frame = captureFrame()
    if (!frame) return
    const data = await faceGrant.mutateAsync({ id: faceGrantPoint, image: frame })
    setGrantResult(data)
  }

  return (
    <div>
      <PageHeader
        title="Access Control"
        description="Door, turnstile, and gate control when face is recognized, liveness passes, and access is authorized."
      />

      {config && (
        <Card className="mb-6">
          <h2 className="mb-2 text-lg font-medium">Grant conditions</h2>
          <ul className="list-inside list-disc text-sm text-slate-300">
            {Object.entries(config.grant_conditions).map(([k, v]) => (
              <li key={k}>
                {k.replace(/_/g, ' ')}: {v ? 'required' : 'optional'}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-medium">Add access point</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={create}>
          <Label>
            Name
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Device type
            <Select
              value={form.device_type}
              onChange={(e) => setForm({ ...form, device_type: e.target.value })}
            >
              {config &&
                Object.entries(config.device_types).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </Select>
          </Label>
          <Label>
            Default action
            <Select
              value={form.default_action}
              onChange={(e) => setForm({ ...form, default_action: e.target.value })}
            >
              {config &&
                Object.entries(config.actions).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </Select>
          </Label>
          <Label>
            Controller URL (optional)
            <Input
              placeholder="http://controller/unlock"
              value={form.controller_url}
              onChange={(e) => setForm({ ...form, controller_url: e.target.value })}
            />
          </Label>
          <div className="sm:col-span-2">
            <Button type="submit">Create access point</Button>
          </div>
        </form>
      </Card>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Action</Th>
          <Th>Camera</Th>
          <Th>Face grant</Th>
          <Th>Manual control</Th>
        </TableHead>
        <TableBody>
          {points.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}</Td>
              <Td>{p.device_type}</Td>
              <Td>{config?.actions[p.default_action] ?? p.default_action}</Td>
              <Td>{p.camera?.name ?? '—'}</Td>
              <Td>
                <Button variant="ghost" onClick={() => openFaceGrant(p.id)}>
                  Test face grant
                </Button>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {config &&
                    Object.keys(config.actions).map((action) => (
                      <Button key={action} variant="ghost" onClick={() => execute(p.id, action)}>
                        {config.actions[action]}
                      </Button>
                    ))}
                </div>
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>

      {faceGrantPoint !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-lg">
            <h3 className="mb-4 text-lg font-medium">Face grant test</h3>
            <p className="mb-3 text-sm text-slate-400">
              Simulates door camera recognition for employees and checked-in visitors with zone permissions.
            </p>
            <video ref={videoRef} autoPlay playsInline muted className="mb-4 w-full rounded-lg bg-black" />
            {grantResult && (
              <div className="mb-4 rounded-lg bg-slate-800 p-3 text-sm">
                <Badge tone={grantResult.granted ? 'ok' : 'danger'}>
                  {grantResult.granted ? 'Access granted' : 'Access denied'}
                </Badge>
                {grantResult.identity_type && (
                  <p className="mt-2 capitalize">Identity: {grantResult.identity_type}</p>
                )}
                {grantResult.deny_reason && <p className="text-red-400">{grantResult.deny_reason}</p>}
                {grantResult.action && <p>Action: {grantResult.action}</p>}
                <p className="text-slate-500">Confidence: {(grantResult.confidence * 100).toFixed(1)}%</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={runFaceGrant} disabled={!active || faceGrant.isPending}>
                {faceGrant.isPending ? 'Identifying…' : 'Capture & grant'}
              </Button>
              <Button variant="ghost" onClick={closeFaceGrant}>Close</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
