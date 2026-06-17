"""Data-integrity test for the org-tree merge migration's backfill.

The full alembic chain is PostgreSQL-only, but the migration's data transform
(``backfill_org_tree``) is portable SQL. Here we build the PRE-migration shape
in raw SQLite, seed the tricky cases the red-team flagged, run the backfill, and
assert the outcomes: code-collision de-dup, department-wins precedence, the
divergent-branch audit, the root-less-user guard, and cross-org corruption fix.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

_MIG = (
    Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "g3b4c5d6e7f8_org_tree_merge.py"
)


def _load_backfill():
    spec = importlib.util.spec_from_file_location("org_tree_merge_mig", _MIG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.backfill_org_tree


_PRE_SCHEMA = [
    # organizations already carries the additive tree columns (the migration's
    # DDL runs before backfill); existing rows are roots with NULL tree cols.
    """CREATE TABLE organizations (
        id INTEGER PRIMARY KEY, name TEXT, code TEXT,
        parent_id INTEGER, root_organization_id INTEGER,
        node_type TEXT DEFAULT 'company', path TEXT, depth INTEGER DEFAULT 0,
        address TEXT, timezone TEXT DEFAULT 'UTC', settings TEXT, is_active INTEGER DEFAULT 1
    )""",
    """CREATE TABLE branches (
        id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, code TEXT,
        address TEXT, timezone TEXT DEFAULT 'UTC', is_active INTEGER DEFAULT 1
    )""",
    """CREATE TABLE departments (
        id INTEGER PRIMARY KEY, organization_id INTEGER, branch_id INTEGER,
        name TEXT, code TEXT, is_active INTEGER DEFAULT 1
    )""",
    """CREATE TABLE employees (
        id INTEGER PRIMARY KEY, organization_id INTEGER, branch_id INTEGER,
        department_id INTEGER, org_node_id INTEGER, employee_code TEXT, department TEXT
    )""",
    """CREATE TABLE users (
        id INTEGER PRIMARY KEY, organization_id INTEGER, branch_id INTEGER,
        department_id INTEGER, org_node_id INTEGER
    )""",
    """CREATE TABLE locations (
        id INTEGER PRIMARY KEY, organization_id INTEGER, branch_id INTEGER,
        org_node_id INTEGER, name TEXT
    )""",
    """CREATE TABLE _org_merge_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, member_type TEXT, member_id INTEGER,
        branch_id INTEGER, department_id INTEGER
    )""",
]

_SEED = [
    "INSERT INTO organizations (id, name, code) VALUES (1, 'Acme', 'ACME'), (2, 'Beta', 'BETA')",
    # org1 branches: OPS, ENG, and ACME (collides with the root code).
    "INSERT INTO branches (id, organization_id, name, code) VALUES "
    "(10, 1, 'Ops', 'OPS'), (11, 1, 'Eng', 'ENG'), (12, 1, 'AcmeBranch', 'ACME'), (13, 2, 'BetaOps', 'OPS')",
    # depts: D1 under ENG with code OPS (collides with branch OPS); D2 org-wide;
    # D3 points at a branch in ANOTHER org (cross-org corruption).
    "INSERT INTO departments (id, organization_id, branch_id, name, code) VALUES "
    "(20, 1, 11, 'OpsDept', 'OPS'), (21, 1, NULL, 'Finance', 'FIN'), (22, 1, 13, 'Bad', 'BAD')",
    # E1 divergent (branch 10 != dept's branch 11); E2 branch-only; E3 unassigned.
    "INSERT INTO employees (id, organization_id, branch_id, department_id, employee_code) VALUES "
    "(30, 1, 10, 20, 'E1'), (31, 1, 10, NULL, 'E2'), (32, 1, NULL, NULL, 'E3')",
    # U1 root-less (org NULL) but has a dept; U2 branch-scoped.
    "INSERT INTO users (id, organization_id, branch_id, department_id) VALUES "
    "(40, NULL, NULL, 20), (41, 1, 11, NULL)",
    "INSERT INTO locations (id, organization_id, branch_id, name) VALUES "
    "(50, 1, 10, 'HQ'), (51, 1, NULL, 'Annex')",
]


def _setup_conn():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    conn = engine.connect()
    for ddl in _PRE_SCHEMA:
        conn.execute(sa.text(ddl))
    for ins in _SEED:
        conn.execute(sa.text(ins))
    return conn


def _node_id(conn, root_id, code, node_type):
    return conn.execute(
        sa.text(
            "SELECT id FROM organizations WHERE root_organization_id=:r AND code=:c AND node_type=:t"
        ),
        {"r": root_id, "c": code, "t": node_type},
    ).scalar()


def test_backfill_org_tree_integrity():
    backfill = _load_backfill()
    conn = _setup_conn()
    try:
        backfill(conn)

        # Roots self-anchor.
        root1 = conn.execute(sa.text("SELECT root_organization_id, path, depth FROM organizations WHERE id=1")).first()
        assert root1.root_organization_id == 1 and root1.path == "/1/" and root1.depth == 0

        # Code-collision de-dup: branch OPS keeps it; the dept OPS is suffixed;
        # the branch whose code clashed with the root code is suffixed.
        b_ops = _node_id(conn, 1, "OPS", "branch")
        d_ops = _node_id(conn, 1, "OPS-department", "department")
        b_acme = _node_id(conn, 1, "ACME-branch", "branch")
        assert b_ops and d_ops and b_acme

        # Paths/depths consistent for every non-root node.
        rows = conn.execute(sa.text(
            "SELECT id, parent_id, path, depth FROM organizations WHERE parent_id IS NOT NULL"
        )).fetchall()
        by_id = {r.id: r for r in conn.execute(sa.text("SELECT id, path, depth FROM organizations")).fetchall()}
        for r in rows:
            parent = by_id[r.parent_id]
            assert r.path == f"{parent.path}{r.id}/"
            assert r.depth == parent.depth + 1

        # Cross-org dept (D3): its foreign branch link was detached, so it
        # attaches to its OWN company root at depth 1.
        d_bad = _node_id(conn, 1, "BAD", "department")
        bad_row = by_id[d_bad]
        assert bad_row.depth == 1 and bad_row.path == f"/1/{d_bad}/"

        # Org-wide dept (D2, NULL branch) attaches to the root too.
        assert by_id[_node_id(conn, 1, "FIN", "department")].depth == 1

        # Member repoint: department wins, else branch, else NULL.
        emp = {r.id: r.org_node_id for r in conn.execute(sa.text("SELECT id, org_node_id FROM employees")).fetchall()}
        assert emp[30] == d_ops          # E1: dept wins over its branch
        assert emp[31] == b_ops          # E2: branch-only
        assert emp[32] is None           # E3: unassigned

        # Divergent branch link preserved in the audit table.
        audit = conn.execute(sa.text(
            "SELECT member_type, member_id, branch_id, department_id FROM _org_merge_audit"
        )).fetchall()
        assert ("employee", 30, 10, 20) in {(a.member_type, a.member_id, a.branch_id, a.department_id) for a in audit}

        # Users: root-less user is NULLed; branch-scoped user repointed.
        usr = {r.id: r.org_node_id for r in conn.execute(sa.text("SELECT id, org_node_id FROM users")).fetchall()}
        assert usr[40] is None           # org NULL -> no scope node
        b_eng = _node_id(conn, 1, "ENG", "branch")
        assert usr[41] == b_eng

        # Locations repoint via branch.
        loc = {r.id: r.org_node_id for r in conn.execute(sa.text("SELECT id, org_node_id FROM locations")).fetchall()}
        assert loc[50] == b_ops
        assert loc[51] is None

        # No member assigned to a node in a different tenant.
        cross = conn.execute(sa.text(
            "SELECT count(*) FROM employees e JOIN organizations o ON o.id=e.org_node_id "
            "WHERE o.root_organization_id <> e.organization_id"
        )).scalar()
        assert cross == 0
    finally:
        conn.close()
