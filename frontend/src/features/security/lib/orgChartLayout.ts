import type { OrgNode } from '@/features/security/types'

/**
 * Pure tidy-tree layout for the organization chart. No React, no DOM — given a
 * nested node tree it returns absolute (pre-zoom) pixel positions for every
 * visible node plus the connector geometry between parents and children.
 *
 * The algorithm is the classic top-down org-chart placement: leaves are handed
 * sequential horizontal slots and every parent is centered over the span of its
 * laid-out children. Because only leaves consume horizontal space, sibling
 * subtrees never overlap. Collapsed nodes contribute a single slot (their
 * children are not laid out) so a collapsed branch reads as one card.
 */

export interface OrgChartNode {
  node: OrgNode
  id: number
  /** Top-left corner of the card, in layout pixels (before pan/zoom). */
  x: number
  y: number
  depth: number
  /** Direct children present in the data, regardless of collapse state. */
  childCount: number
  /** True when this node has children that are currently hidden. */
  collapsed: boolean
}

export interface OrgChartEdge {
  parentId: number
  childId: number
  /** Parent bottom-center. */
  x1: number
  y1: number
  /** Child top-center. */
  x2: number
  y2: number
}

export interface OrgChartLayout {
  nodes: OrgChartNode[]
  edges: OrgChartEdge[]
  /** Total content extent — drives the SVG canvas and fit-to-view math. */
  width: number
  height: number
}

export interface OrgChartLayoutOptions {
  nodeWidth: number
  nodeHeight: number
  /** Horizontal gap between adjacent sibling subtrees. */
  hGap: number
  /** Vertical gap between a parent row and its child row. */
  vGap: number
  /** Ids of nodes whose children should be hidden. */
  collapsed?: ReadonlySet<number>
}

const NO_COLLAPSE: ReadonlySet<number> = new Set<number>()

export function layoutOrgChart(
  roots: OrgNode[] | null | undefined,
  opts: OrgChartLayoutOptions
): OrgChartLayout {
  const { nodeWidth, nodeHeight, hGap, vGap } = opts
  const collapsed = opts.collapsed ?? NO_COLLAPSE
  const levelHeight = nodeHeight + vGap
  const slot = nodeWidth + hGap

  const nodes: OrgChartNode[] = []
  const edges: OrgChartEdge[] = []
  let cursor = 0

  const place = (node: OrgNode, depth: number): OrgChartNode => {
    const children = node.children ?? []
    const isCollapsed = collapsed.has(node.id) && children.length > 0
    const laidOut = isCollapsed ? [] : children
    const kidRecords = laidOut.map((kid) => place(kid, depth + 1))

    const x =
      kidRecords.length === 0
        ? (() => {
            const at = cursor
            cursor += slot
            return at
          })()
        : (kidRecords[0].x + kidRecords[kidRecords.length - 1].x) / 2
    const y = depth * levelHeight

    const record: OrgChartNode = {
      node,
      id: node.id,
      x,
      y,
      depth,
      childCount: children.length,
      collapsed: isCollapsed,
    }
    nodes.push(record)

    for (const kid of kidRecords) {
      edges.push({
        parentId: node.id,
        childId: kid.id,
        x1: x + nodeWidth / 2,
        y1: y + nodeHeight,
        x2: kid.x + nodeWidth / 2,
        y2: kid.y,
      })
    }
    return record
  }

  for (const root of roots ?? []) place(root, 0)

  let width = 0
  let height = 0
  for (const n of nodes) {
    if (n.x + nodeWidth > width) width = n.x + nodeWidth
    if (n.y + nodeHeight > height) height = n.y + nodeHeight
  }

  return { nodes, edges, width, height }
}
