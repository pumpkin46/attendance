import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Paginated } from '../types'

interface VisitorKiosk {
  id: number
  name: string
  device_id: string
  is_active: boolean
  online: boolean
  allow_walk_in: boolean
  require_host: boolean
  last_heartbeat_at?: string
}

export default function VisitorKiosksPage() {
  const [kiosks, setKiosks] = useState<VisitorKiosk[]>([])
  const [form, setForm] = useState({ organization_id: '1', name: '' })
  const [lastToken, setLastToken] = useState<{ url: string; token: string } | null>(null)

  const load = () =>
    api
      .get<VisitorKiosk[] | Paginated<VisitorKiosk>>('/visitor-kiosks')
      .then((r) => {
        const payload = r.data
        setKiosks(Array.isArray(payload) ? payload : (payload.data ?? []))
      })
      .catch(() => setKiosks([]))

  useEffect(() => {
    load()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const { data } = await api.post<{ kiosk_url?: string; api_token_plain?: string }>('/visitor-kiosks', {
      organization_id: Number(form.organization_id),
      name: form.name,
      allow_walk_in: true,
      require_liveness: true,
    })
    if (data.api_token_plain && data.kiosk_url) {
      setLastToken({ url: data.kiosk_url, token: data.api_token_plain })
    }
    setForm({ organization_id: '1', name: '' })
    load()
  }

  const regenerate = async (id: number) => {
    const { data } = await api.post<{ kiosk_url?: string; api_token_plain?: string }>(
      `/visitor-kiosks/${id}/regenerate-token`
    )
    if (data.api_token_plain && data.kiosk_url) {
      setLastToken({ url: data.kiosk_url, token: data.api_token_plain })
    }
  }

  return (
    <div>
      <PageHeader
        title="Autonomous Visitor Kiosks"
        description="Deploy self-service kiosks for walk-in registration, face enrollment, and check-in without reception staff."
      />

      {lastToken && (
        <Card className="mb-6 border-green-800 bg-green-950/40">
          <p className="mb-2 text-sm font-medium text-green-300">Kiosk URL (open on tablet at lobby)</p>
          <code className="block break-all text-xs text-slate-200">{lastToken.url}</code>
          <p className="mt-3 text-xs text-slate-400">API token (shown once): {lastToken.token}</p>
        </Card>
      )}

      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-4" onSubmit={submit}>
          <Label>
            Kiosk name
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Button type="submit">Create kiosk</Button>
        </form>
      </Card>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Device ID</Th>
          <Th>Online</Th>
          <Th>Walk-in</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {kiosks.map((k) => (
            <tr key={k.id}>
              <Td>{k.name}</Td>
              <Td className="font-mono text-xs">{k.device_id}</Td>
              <Td>
                <Badge tone={k.online ? 'ok' : 'neutral'}>{k.online ? 'Online' : 'Offline'}</Badge>
              </Td>
              <Td>{k.allow_walk_in ? 'Yes' : 'No'}</Td>
              <Td>
                <Button variant="ghost" onClick={() => regenerate(k.id)}>
                  Regenerate token
                </Button>
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
