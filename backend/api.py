import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, Query
from fastapi.staticfiles import StaticFiles

from . import buckets, db, scheduler, scraper, states

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    stop = asyncio.Event()
    task = asyncio.create_task(scheduler.run(stop))
    try:
        yield
    finally:
        stop.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Election Results Dashboard", lifespan=lifespan)
api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict:
    return {"ok": True}


@api.get("/states")
def list_states() -> list[dict[str, str]]:
    return states.enabled_states()


@api.post("/scrape")
def scrape(
    state: str = Query("S22"),
    max_pages: int = Query(50, ge=1, le=200),
    delay: float = Query(0.5, ge=0.0, le=10.0),
) -> dict:
    return scraper.scrape_state(state, max_pages=max_pages, delay=delay)


@api.get("/contests")
def contests(
    state: str | None = None,
    party: str | None = None,
    limit: int = Query(1000, ge=1, le=10000),
) -> list[dict]:
    sql = "SELECT * FROM contests"
    where: list[str] = []
    args: list = []
    if state:
        where.append("state_code = ?")
        args.append(state)
    if party:
        where.append("(leading_party = ? OR trailing_party = ?)")
        args += [party, party]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY state_code, ac_no LIMIT ?"
    args.append(limit)
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(sql, args)]


@api.get("/buckets")
def buckets_endpoint(state: str | None = None) -> dict:
    return {
        "buckets": buckets.BUCKET_LABELS,
        "parties": buckets.party_lead_trail(state_code=state),
    }


@api.get("/summary")
def summary(state: str | None = None) -> dict:
    args: tuple = ()
    where = ""
    if state:
        where = " WHERE state_code = ?"
        args = (state,)
    with db.connect() as conn:
        leads = [
            dict(r)
            for r in conn.execute(
                f"SELECT leading_party, COUNT(*) AS seats FROM contests{where} "
                "GROUP BY leading_party ORDER BY seats DESC",
                args,
            )
        ]
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM contests{where}", args
        ).fetchone()["n"]
        last_run = conn.execute(
            "SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return {
        "total_contests": total,
        "by_leading_party": leads,
        "last_scrape": dict(last_run) if last_run else None,
    }


app.include_router(api)

if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
