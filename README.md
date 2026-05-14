# Election Results Dashboard

Video Walkthrough: [https://www.loom.com/share/575a0d548664437b950b295bdd91fa06]

A live election-night dashboard for results from
[results.eci.gov.in](https://results.eci.gov.in/). Python backend scrapes the
ECI statewise pages, stores rows in SQLite, and serves a broadsheet-style
frontend with party-wise lead/trail margin buckets.

```
election-dashboard/
├── backend/
│   ├── api.py        FastAPI app, /api/* + static frontend mount
│   ├── buckets.py    Margin → bucket labels + party aggregation
│   ├── cli.py        init / scrape / serve commands
│   ├── db.py         SQLite schema + upsert
│   └── scraper.py    curl_cffi (Chrome impersonation) + BeautifulSoup parser
├── frontend/
│   ├── index.html    "The Counting Context" markup
│   ├── styles.css    Editorial broadsheet styling
│   └── app.js        Custom SVG margin pyramid + tables
├── data/
│   └── results.db    SQLite file (created on first init)
└── pyproject.toml    uv-managed Python project
```

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (package + venv manager)

## Install

```bash
uv sync
```

This creates `.venv/` and installs all dependencies.

## Run

The CLI exposes three subcommands:

```bash
# 1. Create the SQLite schema (first time only)
uv run python -m backend.cli init

# 2. Scrape a state from the ECI wire
uv run python -m backend.cli scrape --state S22

# 3. Serve the dashboard at http://127.0.0.1:8000
uv run python -m backend.cli serve
```

The server starts an in-process scheduler that re-scrapes the configured state(s)
every 5 minutes. The frontend polls the API every 30 seconds so new bulletins
appear without a page reload. Override with env vars:

| Variable                   | Default | Notes                                                              |
|----------------------------|---------|--------------------------------------------------------------------|
| `SCRAPE_STATES`            | `S22`   | Comma-separated state codes, e.g. `S22,S04,S10`.                   |
| `SCRAPE_INTERVAL_SECONDS`  | `300`   | Minimum 30s.                                                       |
| `SCRAPE_ON_STARTUP`        | `1`     | Set `0` to skip the immediate scrape and wait one full interval.   |

You can also use the installed entrypoint:

```bash
uv run election-dashboard scrape --state S22
uv run election-dashboard serve
```

### CLI flags

| Command | Flag           | Default     | Notes                                                |
|---------|----------------|-------------|------------------------------------------------------|
| scrape  | `--state`      | `S22`       | ECI state code (S01..S29 for states, U01..U08 UTs).  |
| scrape  | `--max-pages`  | `50`        | Hard cap on pagination (`statewise<STATE>{N}.htm`).  |
| scrape  | `--delay`      | `0.5`       | Seconds between requests.                            |
| serve   | `--host`       | `127.0.0.1` |                                                      |
| serve   | `--port`       | `8000`      |                                                      |

### State codes

A few useful ones:

| Code | State            | Code | State           |
|------|------------------|------|-----------------|
| S04  | Bihar            | S22  | Tamil Nadu      |
| S10  | Karnataka        | S24  | Uttar Pradesh   |
| S13  | Maharashtra      | S25  | West Bengal     |
| S19  | Punjab           | S29  | Telangana       |
| U05  | Delhi            | U07  | Puducherry      |

The scraper paginates `statewise<CODE>1.htm`, `statewise<CODE>2.htm`, … and
stops on the first 404 or empty page.

## API

All JSON endpoints are served under `/api`. FastAPI auto-generates interactive
documentation at the following URLs (server must be running):

- **Swagger UI**: <http://127.0.0.1:8000/docs>
- **ReDoc**: <http://127.0.0.1:8000/redoc>
- **OpenAPI schema (JSON)**: <http://127.0.0.1:8000/openapi.json>

| Method | Path                        | Description                                                                                |
|--------|-----------------------------|--------------------------------------------------------------------------------------------|
| GET    | `/api/health`               | Liveness probe.                                                                            |
| POST   | `/api/scrape`               | Trigger a scrape. Query: `state` (default `S22`), `max_pages`, `delay`.                    |
| GET    | `/api/contests`             | List contests. Query: `state`, `party`, `limit`.                                           |
| GET    | `/api/buckets`              | Party-wise lead/trail counts per margin bucket. Query: `state` (optional).                 |
| GET    | `/api/summary`              | Total contests, seats by leading party, last scrape metadata. Query: `state` (optional).   |

### Margin buckets

Tapered, in absolute votes:
`0-1k`, `1-2k`, `2-3k`, `3-4k`, `4-5k`, `5-10k`, `10-20k`, `20-50k`, `50k+`.

Each contest contributes `+1` to the **leading** party's lead-bucket and `+1`
to the **trailing** party's trail-bucket, so a row in `/api/buckets` looks
like:

```json
{
  "buckets": ["0-1k","1-2k","2-3k","3-4k","4-5k","5-10k","10-20k","20-50k","50k+"],
  "parties": {
    "Tamilaga Vettri Kazhagam": {
      "lead":        {"0-1k": 2, "1-2k": 1, "...": 40},
      "trail":       {"0-1k": 1, "1-2k": 0, "...": 26},
      "lead_total":  43,
      "trail_total": 27
    }
  }
}
```

### Example calls

```bash
# Trigger a scrape
curl -X POST 'http://127.0.0.1:8000/api/scrape?state=S22'

# Buckets
curl 'http://127.0.0.1:8000/api/buckets?state=S22' | jq

# Closest contests
curl 'http://127.0.0.1:8000/api/contests?state=S22&limit=2000' \
  | jq 'sort_by(.margin | fabs)[:8]'
```

## Frontend

Mounted by FastAPI at `/`, no build step. Vanilla JS + SVG. Open
[`http://127.0.0.1:8000/`](http://127.0.0.1:8000/) and click **Stop press ·
Scrape wire** to fetch live data.

The hero visualization is a custom **Margin Pyramid**: each row is a party,
bars to the right of the centerline are seats currently leading, bars to the
left are seats currently trailing. Bucket band is colour-encoded; trailing
segments are hatched.

## Why curl_cffi?

The ECI site is behind Akamai Bot Manager, which blocks `requests` /
`urllib3` based on TLS fingerprint regardless of headers.
[`curl_cffi`](https://github.com/lexiforest/curl_cffi) wraps
`libcurl-impersonate` to forge real Chrome/Firefox TLS fingerprints. The
profile is set in `backend/scraper.py:11` (`IMPERSONATE = "chrome124"`); swap
to `chrome120`, `chrome131`, `safari17_0`, or `firefox133` if Akamai's
detection updates.

## MCP server — chat with the data

An [MCP](https://modelcontextprotocol.io) server is bundled so any MCP client
(Claude Desktop, Claude Code, Cursor, etc.) can ask natural-language questions
of the same `data/results.db`.

```bash
uv run python -m backend.mcp_server
# or:
uv run counting-context-mcp
# or via the CLI:
uv run python -m backend.cli mcp
```

The server speaks stdio. The dashboard scheduler can keep running in another
process; SQLite handles the concurrent reads.

### Tools exposed

| Tool                  | Purpose                                                                                       |
|-----------------------|-----------------------------------------------------------------------------------------------|
| `list_states`         | Enabled state codes + names.                                                                  |
| `get_summary`         | Total contests, seats by leading party, last scrape.                                          |
| `search_constituency` | Substring search on AC name, scoped optionally to one state.                                  |
| `get_constituency`    | Full row by `ac_no` or `name`.                                                                |
| `list_contests`       | Filter by `party`, `side` (lead/trail), `min_margin`, `max_margin`; sort closest or biggest.  |
| `get_party_buckets`   | The full lead/trail margin-bucket distribution; can scope to one party.                       |
| `top_parties`         | Parties ranked by seats currently leading or trailing.                                        |

### Wire it into Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "counting-context": {
      "command": "uv",
      "args": [
        "--directory", "C:\\Users\\aadit\\codebase\\election-dashboard",
        "run", "python", "-m", "backend.mcp_server"
      ]
    }
  }
}
```

Restart Claude Desktop and ask things like *"Which seats is BJP leading by under
2,000 votes in West Bengal?"* or *"Summarize the closest contests in Tamil
Nadu."* The model will call the appropriate tools.

### Wire it into Claude Code

```bash
claude mcp add counting-context -- uv --directory /path/to/election-dashboard run python -m backend.mcp_server
```

## Deploy

The app is stateful (SQLite file + in-process scheduler), so it needs a host
with a persistent disk and a long-lived process — not serverless.

### Fly.io (recommended, ~5 min)

`Dockerfile`, `.dockerignore`, and `fly.toml` are committed. Mumbai (`bom`) is
the closest region to `results.eci.gov.in`.

```bash
# 1. Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly auth signup     # or: fly auth login

# 2. From the project root:
fly launch --copy-config --no-deploy
#    accept the existing fly.toml when prompted; pick a unique app name.

# 3. Create the persistent volume the SQLite file lives on:
fly volumes create data --region bom --size 1

# 4. Ship it:
fly deploy
fly open            # opens https://<app>.fly.dev/
```

After the first deploy the scheduler boots, scrapes the four enabled states,
and writes to `/app/data/results.db` on the volume. The volume survives
redeploys.

Useful commands:

```bash
fly logs                                  # tail server + scheduler logs
fly ssh console                           # exec into the running machine
fly secrets set SCRAPE_STATES=S22,S25     # override env at runtime
fly scale memory 1024                     # bump RAM if scrapes get heavy
```

### Alternatives

- **Railway** — connect a GitHub repo, add a Persistent Volume mounted at
  `/app/data`, set start command to `uvicorn backend.api:app --host 0.0.0.0
  --port $PORT`. Free trial; needs a repo.
- **Render** — Web Service from repo, Docker build, attach a Disk at
  `/app/data` (paid plan only). Easiest UI flow.
- **Hetzner / DigitalOcean / Lightsail VPS** — `docker run` the image with a
  bind mount on `./data`. Cheapest at scale (~$4–6/mo).

Avoid pure serverless (AWS Lambda, Vercel, Cloud Run with min-instances=0):
the 5-minute scheduler can't run if the process is being torn down between
requests, and SQLite needs durable disk.

## Database

SQLite, file-backed at `data/results.db`. Two tables:

- `contests(state_code, ac_no PK, ac_name, leading_candidate, leading_party,
  trailing_candidate, trailing_party, margin, round, status, scraped_at)` —
  upserted on each scrape so live results overwrite cleanly.
- `scrape_runs(id, state_code, pages_fetched, rows_upserted, started_at,
  finished_at)` — audit log of every scrape.

To reset, just delete `data/results.db` and re-run `init`.
