"""MCP server exposing the election-dashboard SQLite data to LLM clients.

Run via stdio (e.g. from Claude Desktop / Claude Code):

    uv run python -m backend.mcp_server
"""

from typing import Any

from mcp.server.fastmcp import FastMCP

from . import buckets, db, states

mcp = FastMCP("counting-context")


def _bad_state(code: str) -> dict[str, Any]:
    return {
        "error": f"State '{code}' is not enabled.",
        "available_states": states.enabled_states(),
    }


@mcp.tool()
def list_states() -> list[dict[str, str]]:
    """List the Indian states currently tracked by the dashboard.

    Returns a list of {code, name} pairs. Use the `code` field as the `state`
    argument for other tools.
    """
    return states.enabled_states()


@mcp.tool()
def get_summary(state: str) -> dict[str, Any]:
    """Top-line numbers for a state: total contests reporting, seats by leading
    party (descending), and metadata about the last scrape.

    Args:
        state: State code from `list_states` (e.g. 'S22' for Tamil Nadu).
    """
    code = state.strip().upper()
    if not states.is_enabled(code):
        return _bad_state(code)

    with db.connect() as conn:
        leads = [
            dict(r) for r in conn.execute(
                "SELECT leading_party, COUNT(*) AS seats FROM contests "
                "WHERE state_code = ? GROUP BY leading_party ORDER BY seats DESC",
                (code,),
            )
        ]
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM contests WHERE state_code = ?", (code,),
        ).fetchone()["n"]
        last_run = conn.execute(
            "SELECT * FROM scrape_runs WHERE state_code = ? ORDER BY id DESC LIMIT 1",
            (code,),
        ).fetchone()

    return {
        "state": {"code": code, "name": states.name_for(code)},
        "total_contests": total,
        "by_leading_party": leads,
        "last_scrape": dict(last_run) if last_run else None,
    }


@mcp.tool()
def search_constituency(
    query: str,
    state: str | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Find constituencies by name (case-insensitive substring match), sorted
    by tightest current margin first.

    Args:
        query: Substring of the constituency name (e.g. 'mylapore', 'park').
        state: Optional state code to scope the search.
        limit: Max results, 1–50 (default 10).
    """
    limit = max(1, min(50, int(limit)))
    sql = (
        "SELECT state_code, ac_no, ac_name, leading_party, trailing_party, "
        "margin, status FROM contests WHERE ac_name LIKE ? COLLATE NOCASE"
    )
    args: list[Any] = [f"%{query}%"]
    if state:
        sql += " AND state_code = ?"
        args.append(state.strip().upper())
    sql += " ORDER BY ABS(margin) ASC LIMIT ?"
    args.append(limit)

    with db.connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


@mcp.tool()
def get_constituency(
    state: str,
    ac_no: int | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    """Full record for one constituency. Provide either ``ac_no`` (assembly
    constituency number) or ``name`` (substring; case-insensitive).

    Args:
        state: State code.
        ac_no: Assembly constituency number, when known.
        name: Constituency name (full or partial).
    """
    code = state.strip().upper()
    if not states.is_enabled(code):
        return _bad_state(code)

    if ac_no is not None:
        sql = "SELECT * FROM contests WHERE state_code = ? AND ac_no = ?"
        args: tuple = (code, int(ac_no))
    elif name:
        sql = (
            "SELECT * FROM contests WHERE state_code = ? AND ac_name "
            "LIKE ? COLLATE NOCASE ORDER BY ABS(margin) ASC LIMIT 1"
        )
        args = (code, f"%{name}%")
    else:
        return {"error": "Provide either `ac_no` or `name`."}

    with db.connect() as conn:
        row = conn.execute(sql, args).fetchone()

    if not row:
        return {"error": f"No constituency found in {code} matching ac_no={ac_no}, name={name!r}."}
    return dict(row)


@mcp.tool()
def list_contests(
    state: str,
    party: str | None = None,
    side: str | None = None,
    min_margin: int | None = None,
    max_margin: int | None = None,
    sort: str = "margin_asc",
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Filtered list of contests in a state.

    Args:
        state: State code.
        party: Optional party name or substring. Use the full ECI name (e.g.
            'Bharatiya Janata Party') or a fragment ('Trinamool').
        side: When ``party`` is given, restrict to where that party is leading
            ('lead') or trailing ('trail'). Default is either.
        min_margin: Inclusive lower bound on absolute vote margin.
        max_margin: Inclusive upper bound on absolute vote margin.
        sort: 'margin_asc' (closest first, default), 'margin_desc' (landslides
            first), or 'ac_no'.
        limit: Max rows, 1–200 (default 20).
    """
    code = state.strip().upper()
    if not states.is_enabled(code):
        return [_bad_state(code)]

    limit = max(1, min(200, int(limit)))
    where = ["state_code = ?"]
    args: list[Any] = [code]

    if party:
        plike = f"%{party}%"
        if side == "lead":
            where.append("leading_party LIKE ? COLLATE NOCASE"); args.append(plike)
        elif side == "trail":
            where.append("trailing_party LIKE ? COLLATE NOCASE"); args.append(plike)
        else:
            where.append("(leading_party LIKE ? COLLATE NOCASE OR trailing_party LIKE ? COLLATE NOCASE)")
            args += [plike, plike]

    if min_margin is not None:
        where.append("ABS(margin) >= ?"); args.append(int(min_margin))
    if max_margin is not None:
        where.append("ABS(margin) <= ?"); args.append(int(max_margin))

    order = {
        "margin_asc": "ABS(margin) ASC",
        "margin_desc": "ABS(margin) DESC",
        "ac_no": "ac_no ASC",
    }.get(sort, "ABS(margin) ASC")

    sql = (
        "SELECT state_code, ac_no, ac_name, leading_candidate, leading_party, "
        "trailing_candidate, trailing_party, margin, round, status "
        f"FROM contests WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?"
    )
    args.append(limit)

    with db.connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


@mcp.tool()
def get_party_buckets(
    state: str,
    party: str | None = None,
) -> dict[str, Any]:
    """Party-wise lead/trail seat counts grouped by margin bucket
    (0-1k, 1-2k, 2-3k, 3-4k, 4-5k, 5-10k, 10-20k, 20-50k, 50k+).

    Each contest contributes +1 to the leading party's lead-bucket and +1 to
    the trailing party's trail-bucket, so the same row appears in both totals.

    Args:
        state: State code.
        party: Optional party name or substring. If given, returns only that
            party's buckets; otherwise returns all parties.
    """
    code = state.strip().upper()
    if not states.is_enabled(code):
        return _bad_state(code)

    data = buckets.party_lead_trail(state_code=code)

    if party:
        match = next((p for p in data if p == party), None) \
             or next((p for p in data if party.lower() in p.lower()), None)
        if not match:
            return {
                "error": f"No party matching '{party}' in {code}.",
                "available_parties": sorted(data.keys()),
            }
        return {
            "buckets": buckets.BUCKET_LABELS,
            "state": code,
            "party": match,
            **data[match],
        }

    return {
        "buckets": buckets.BUCKET_LABELS,
        "state": code,
        "parties": data,
    }


@mcp.tool()
def top_parties(
    state: str,
    by: str = "lead",
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Parties ranked by number of seats currently leading or trailing.

    Args:
        state: State code.
        by: 'lead' (default) or 'trail'.
        limit: Max rows (default 10).
    """
    code = state.strip().upper()
    if not states.is_enabled(code):
        return [_bad_state(code)]

    column = "trailing_party" if by == "trail" else "leading_party"
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT {column} AS party, COUNT(*) AS seats FROM contests "
            f"WHERE state_code = ? GROUP BY {column} ORDER BY seats DESC LIMIT ?",
            (code, max(1, min(50, int(limit)))),
        ).fetchall()
    return [dict(r) for r in rows]


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
