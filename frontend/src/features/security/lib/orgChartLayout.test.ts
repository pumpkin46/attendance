import { describe, expect, it } from 'vitest'
import { layoutOrgChart } from '@/features/security/lib/orgChartLayout'
import type { OrgNode } from '@/features/security/types'

// Minimal node factory — only the fields the layout actually reads matter.
let nextId = 1
function node(name: string, children: OrgNode[] = []): OrgNode {
  const id = nextId++
  return {
    id,
    name,
    code: name.slice(0, 3).toUpperCase(),
    node_type: 'department',
    parent_id: null,
    root_organization_id: 1,
    timezone: 'UTC',
    depth: 0,
    path: '',
    is_active: true,
    children,
  }
}

const OPTS = { nodeWidth: 100, nodeHeight: 40, hGap: 20, vGap: 40 }
// slot = 120, levelHeight = 80

describe('layoutOrgChart', () => {
  it('returns an empty layout for no roots', () => {
    expect(layoutOrgChart([], OPTS)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
    expect(layoutOrgChart(null, OPTS)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('places a lone node at the origin sized to one card', () => {
    const layout = layoutOrgChart([node('Root')], OPTS)
    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(layout.nodes[0]).toMatchObject({ x: 0, y: 0, depth: 0, childCount: 0, collapsed: false })
    expect(layout.width).toBe(100)
    expect(layout.height).toBe(40)
  })

  it('centers a parent over two leaf children and emits an edge each', () => {
    const root = node('Root', [node('A'), node('B')])
    const layout = layoutOrgChart([root], OPTS)

    const byName = Object.fromEntries(layout.nodes.map((n) => [n.node.name, n]))
    expect(byName.A.x).toBe(0)
    expect(byName.B.x).toBe(120)
    // Parent centered between the two leaves.
    expect(byName.Root.x).toBe(60)
    expect(byName.A.y).toBe(80)
    expect(byName.Root.y).toBe(0)

    expect(layout.width).toBe(220) // 2 * 100 + 20
    expect(layout.height).toBe(120) // one level down + card

    expect(layout.edges).toHaveLength(2)
    const toA = layout.edges.find((e) => e.childId === byName.A.id)!
    expect(toA).toMatchObject({ parentId: byName.Root.id, x1: 110, y1: 40, x2: 50, y2: 80 })
  })

  it('drops collapsed children from the layout but keeps the count', () => {
    const root = node('Root', [node('A'), node('B')])
    const layout = layoutOrgChart([root], { ...OPTS, collapsed: new Set([root.id]) })

    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(layout.nodes[0]).toMatchObject({ x: 0, childCount: 2, collapsed: true })
    expect(layout.width).toBe(100)
  })

  it('lays out three levels and re-centers each ancestor', () => {
    const root = node('Root', [node('Mid', [node('L1'), node('L2')])])
    const layout = layoutOrgChart([root], OPTS)
    const byName = Object.fromEntries(layout.nodes.map((n) => [n.node.name, n]))

    expect(byName.L1.x).toBe(0)
    expect(byName.L2.x).toBe(120)
    expect(byName.Mid.x).toBe(60)
    expect(byName.Root.x).toBe(60) // single child → stacked straight above
    expect(byName.Root.depth).toBe(0)
    expect(byName.Mid.depth).toBe(1)
    expect(byName.L1.depth).toBe(2)
    expect(layout.height).toBe(200) // 2 levels * 80 + 40
    expect(layout.edges).toHaveLength(3)
  })

  it('lays multiple roots out side by side', () => {
    const layout = layoutOrgChart([node('One'), node('Two')], OPTS)
    const byName = Object.fromEntries(layout.nodes.map((n) => [n.node.name, n]))
    expect(byName.One.x).toBe(0)
    expect(byName.Two.x).toBe(120)
    expect(layout.width).toBe(220)
  })
})
