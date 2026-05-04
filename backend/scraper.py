import re
import time
from datetime import datetime, timezone

from curl_cffi import requests as cf_requests
from bs4 import BeautifulSoup

from . import db

IMPERSONATE = "chrome124"

BASE_URL = "https://results.eci.gov.in/ResultAcGenMay2026/statewise{state}{page}.htm"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://results.eci.gov.in/",
}


def parse_margin(raw: str):
    if not raw:
        return None
    s = raw.replace(",", "").strip()
    if not s or s in {"-", "—", "NA", "N/A"}:
        return None
    m = re.search(r"-?\d+", s)
    return int(m.group()) if m else None


def parse_html(html: str, state_code: str, scraped_at: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table.table tbody tr")
    out: list[dict] = []
    for row in rows:
        cols = row.find_all("td", recursive=False)
        if len(cols) < 9:
            continue

        leading_party_td = cols[3].find("td")
        trailing_party_td = cols[5].find("td")

        ac_no_raw = cols[1].get_text(strip=True)
        digits = re.sub(r"\D", "", ac_no_raw)
        if not digits:
            continue
        ac_no = int(digits)

        out.append({
            "state_code": state_code,
            "ac_no": ac_no,
            "ac_name": cols[0].get_text(strip=True),
            "leading_candidate": cols[2].get_text(strip=True),
            "leading_party": (
                leading_party_td.get_text(strip=True) if leading_party_td
                else cols[3].get_text(strip=True)
            ),
            "trailing_candidate": cols[4].get_text(strip=True),
            "trailing_party": (
                trailing_party_td.get_text(strip=True) if trailing_party_td
                else cols[5].get_text(strip=True)
            ),
            "margin": parse_margin(cols[6].get_text(strip=True)),
            "round": cols[7].get_text(strip=True),
            "status": cols[8].get_text(strip=True),
            "scraped_at": scraped_at,
        })
    return out


def fetch_page(state_code: str, page: int, session) -> str | None:
    url = BASE_URL.format(state=state_code, page=page)
    resp = session.get(url, headers=HEADERS, timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.text


def scrape_state(state_code: str, max_pages: int = 50, delay: float = 0.5) -> dict:
    started = datetime.now(timezone.utc).isoformat()
    session = cf_requests.Session(impersonate=IMPERSONATE)
    pages_fetched = 0
    rows_upserted = 0

    with db.connect() as conn:
        for page in range(1, max_pages + 1):
            try:
                html = fetch_page(state_code, page, session)
            except cf_requests.HTTPError as e:
                resp = getattr(e, "response", None)
                if resp is not None and resp.status_code == 404:
                    break
                raise
            if html is None:
                break

            scraped_at = datetime.now(timezone.utc).isoformat()
            rows = parse_html(html, state_code, scraped_at)
            if not rows:
                break

            pages_fetched += 1
            for r in rows:
                db.upsert_contest(conn, r)
                rows_upserted += 1

            time.sleep(delay)

        finished = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO scrape_runs (state_code, pages_fetched, rows_upserted, started_at, finished_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (state_code, pages_fetched, rows_upserted, started, finished),
        )

    return {
        "state_code": state_code,
        "pages_fetched": pages_fetched,
        "rows_upserted": rows_upserted,
        "started_at": started,
    }
