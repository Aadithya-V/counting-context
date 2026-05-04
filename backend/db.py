import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "results.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS contests (
    state_code         TEXT    NOT NULL,
    ac_no              INTEGER NOT NULL,
    ac_name            TEXT    NOT NULL,
    leading_candidate  TEXT,
    leading_party      TEXT,
    trailing_candidate TEXT,
    trailing_party     TEXT,
    margin             INTEGER,
    round              TEXT,
    status             TEXT,
    scraped_at         TEXT    NOT NULL,
    PRIMARY KEY (state_code, ac_no)
);
CREATE INDEX IF NOT EXISTS idx_contests_leading  ON contests(leading_party);
CREATE INDEX IF NOT EXISTS idx_contests_trailing ON contests(trailing_party);
CREATE INDEX IF NOT EXISTS idx_contests_state    ON contests(state_code);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    state_code    TEXT    NOT NULL,
    pages_fetched INTEGER NOT NULL,
    rows_upserted INTEGER NOT NULL,
    started_at    TEXT    NOT NULL,
    finished_at   TEXT    NOT NULL
);
"""


def init_db(path: Path = DB_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect(path: Path = DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


UPSERT_SQL = """
INSERT INTO contests (
    state_code, ac_no, ac_name,
    leading_candidate, leading_party,
    trailing_candidate, trailing_party,
    margin, round, status, scraped_at
) VALUES (
    :state_code, :ac_no, :ac_name,
    :leading_candidate, :leading_party,
    :trailing_candidate, :trailing_party,
    :margin, :round, :status, :scraped_at
)
ON CONFLICT(state_code, ac_no) DO UPDATE SET
    ac_name            = excluded.ac_name,
    leading_candidate  = excluded.leading_candidate,
    leading_party      = excluded.leading_party,
    trailing_candidate = excluded.trailing_candidate,
    trailing_party     = excluded.trailing_party,
    margin             = excluded.margin,
    round              = excluded.round,
    status             = excluded.status,
    scraped_at         = excluded.scraped_at
"""


def upsert_contest(conn: sqlite3.Connection, row: dict) -> None:
    conn.execute(UPSERT_SQL, row)
