from collections import defaultdict

from . import db

BUCKETS: list[tuple[float, float, str]] = [
    (0,      1000,         "0-1k"),
    (1000,   2000,         "1-2k"),
    (2000,   3000,         "2-3k"),
    (3000,   4000,         "3-4k"),
    (4000,   5000,         "4-5k"),
    (5000,   10000,        "5-10k"),
    (10000,  20000,        "10-20k"),
    (20000,  50000,        "20-50k"),
    (50000,  float("inf"), "50k+"),
]

BUCKET_LABELS: list[str] = [b[2] for b in BUCKETS]


def bucket_for(margin: int | None) -> str | None:
    if margin is None:
        return None
    m = abs(margin)
    for lo, hi, label in BUCKETS:
        if lo <= m < hi:
            return label
    return None


def empty_party_row() -> dict:
    return {
        "lead":        {b: 0 for b in BUCKET_LABELS},
        "trail":       {b: 0 for b in BUCKET_LABELS},
        "lead_total":  0,
        "trail_total": 0,
    }


def party_lead_trail(state_code: str | None = None) -> dict[str, dict]:
    parties: dict[str, dict] = defaultdict(empty_party_row)

    sql = "SELECT leading_party, trailing_party, margin FROM contests"
    args: tuple = ()
    if state_code:
        sql += " WHERE state_code = ?"
        args = (state_code,)

    with db.connect() as conn:
        for row in conn.execute(sql, args):
            b = bucket_for(row["margin"])
            if b is None:
                continue
            lp = row["leading_party"] or "Unknown"
            tp = row["trailing_party"] or "Unknown"
            parties[lp]["lead"][b] += 1
            parties[lp]["lead_total"] += 1
            parties[tp]["trail"][b] += 1
            parties[tp]["trail_total"] += 1

    return dict(parties)
