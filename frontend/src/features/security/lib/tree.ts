import type { OrgNode } from '@/features/security/types'

/**
 * Pure helpers for working with the organization tree returned by
 * `GET /org-nodes/tree`. No React — safe to unit test in isolation.
 */

/** Depth-first flatten of a nested node list into a parent-before-children array. */
export function flattenTree(nodes: OrgNode[] | null | undefined): OrgNode[] {
  const out: OrgNode[] = []
  const walk = (list: OrgNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(nodes ?? [])
  return out
}

/** Ids of every descendant of `node` (excludes the node itself). */
export function descendantIds(node: OrgNode): Set<number> {
  const ids = new Set<number>()
  const walk = (list: OrgNode[] | null | undefined) => {
    for (const child of list ?? []) {
      ids.add(child.id)
      walk(child.children)
    }
  }
  walk(node.children)
  return ids
}

/**
 * Ids of every ancestor of `id`, root-most first is irrelevant (it's a Set).
 * Excludes the node itself; empty if the node is a root or absent.
 */
export function ancestorIds(roots: OrgNode[] | null | undefined, id: number): Set<number> {
  const byId = new Map(flattenTree(roots).map((n) => [n.id, n]))
  const ids = new Set<number>()
  let cur = byId.get(id)
  while (cur && cur.parent_id != null && !ids.has(cur.parent_id)) {
    ids.add(cur.parent_id)
    cur = byId.get(cur.parent_id)
  }
  return ids
}

/** Find a node anywhere in the tree by id. */
export function findNode(nodes: OrgNode[] | null | undefined, id: number): OrgNode | null {
  for (const node of nodes ?? []) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

/**
 * Map of node id -> a readable breadcrumb of NAMES ("Acme / Technology / Backend").
 * The materialized `path` is a list of ancestor ids; we resolve each id to its
 * name via the flattened tree (the list endpoints only return ids, not names).
 */
export function breadcrumbLabels(roots: OrgNode[] | null | undefined): Map<number, string> {
  const flat = flattenTree(roots)
  const nameById = new Map(flat.map((n) => [n.id, n.name]))
  const labels = new Map<number, string>()
  for (const node of flat) {
    const ids = node.path.split('/').filter(Boolean).map(Number)
    labels.set(node.id, ids.map((id) => nameById.get(id) ?? String(id)).join(' / ') || node.name)
  }
  return labels
}
