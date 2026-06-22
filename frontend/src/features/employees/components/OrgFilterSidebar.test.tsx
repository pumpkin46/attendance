import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrgFilterSidebar } from '@/features/employees/components/OrgFilterSidebar'
import type { OrgNode } from '@/features/security/types'

const node = (
  id: number,
  name: string,
  parent_id: number | null,
  depth: number,
  children: OrgNode[] = []
): OrgNode => ({
  id,
  name,
  code: name.toUpperCase(),
  node_type: parent_id === null ? 'company' : 'department',
  parent_id,
  root_organization_id: 1,
  timezone: 'UTC',
  depth,
  path: '',
  is_active: true,
  children,
})

// Acme ─ Technology ─ Backend
//      └ Finance
const tree: OrgNode[] = [
  node(1, 'Acme', null, 0, [
    node(2, 'Technology', 1, 1, [node(3, 'Backend', 2, 2)]),
    node(4, 'Finance', 1, 1),
  ]),
]
// Direct per-node counts → sub-tree roll-up: Backend 3, Technology 2+3=5,
// Finance 4, Acme 1+5+4=10. Total = 10.
const counts = { '1': 1, '2': 2, '3': 3, '4': 4 }

function setup(selectedId: number | null = null) {
  const onSelect = vi.fn()
  render(
    <OrgFilterSidebar tree={tree} counts={counts} selectedId={selectedId} onSelect={onSelect} />
  )
  return { onSelect }
}

describe('OrgFilterSidebar', () => {
  it('shows the company total on "All employees"', () => {
    setup()
    const all = screen.getByText('All employees').closest('button')!
    expect(all).toHaveTextContent('10')
  })

  it('rolls per-node counts up into sub-tree totals', () => {
    setup()
    const tech = screen.getByText('Technology').closest('[role="treeitem"]')!
    expect(tech).toHaveTextContent('5') // 2 (Technology) + 3 (Backend)
    const backend = screen.getByText('Backend').closest('[role="treeitem"]')!
    expect(backend).toHaveTextContent('3')
  })

  it('selects a unit on click', () => {
    const { onSelect } = setup()
    fireEvent.click(screen.getByText('Technology'))
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('clears the filter via "All employees"', () => {
    const { onSelect } = setup(2)
    fireEvent.click(screen.getByText('All employees'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected unit', () => {
    setup(2)
    const tech = screen.getByText('Technology').closest('[role="treeitem"]')!
    expect(tech).toHaveAttribute('aria-selected', 'true')
  })
})
