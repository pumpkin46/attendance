import { beforeEach, describe, expect, it } from 'vitest'
import { ancestorIds, descendantIds, findNode } from '@/features/security/lib/tree'
import type { OrgNode } from '@/features/security/types'

let auto = 1
beforeEach(() => {
  auto = 1
})
function node(name: string, children: OrgNode[] = [], parentId: number | null = null): OrgNode {
  const id = auto++
  const n: OrgNode = {
    id,
    name,
    code: name.slice(0, 3).toUpperCase(),
    node_type: 'department',
    parent_id: parentId,
    root_organization_id: 1,
    timezone: 'UTC',
    depth: 0,
    path: '',
    is_active: true,
    children,
  }
  for (const c of children) c.parent_id = id
  return n
}

describe('ancestorIds', () => {
  // root -> mid -> leaf
  const leaf = node('Leaf')
  const mid = node('Mid', [leaf])
  const root = node('Root', [mid])

  it('returns every ancestor of a deep node', () => {
    expect(ancestorIds([root], leaf.id)).toEqual(new Set([mid.id, root.id]))
  })

  it('returns just the parent for a one-level child', () => {
    expect(ancestorIds([root], mid.id)).toEqual(new Set([root.id]))
  })

  it('returns empty for a root or an unknown id', () => {
    expect(ancestorIds([root], root.id)).toEqual(new Set())
    expect(ancestorIds([root], 9999)).toEqual(new Set())
  })

  it('cooperates with descendantIds/findNode on the same tree', () => {
    expect(descendantIds(root)).toEqual(new Set([mid.id, leaf.id]))
    expect(findNode([root], leaf.id)?.name).toBe('Leaf')
  })

  it('stops at a parent_id that has no node (dangling reference)', () => {
    const orphan = node('Orphan')
    orphan.parent_id = 9999
    expect(ancestorIds([orphan], orphan.id)).toEqual(new Set([9999]))
  })

  it('terminates on a parent cycle instead of looping forever', () => {
    const a = node('A')
    const b = node('B')
    a.parent_id = b.id
    b.parent_id = a.id
    expect(ancestorIds([a, b], a.id)).toEqual(new Set([b.id, a.id]))
  })
})
