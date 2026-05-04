import asyncio
import logging
import os
from typing import Iterable

from . import scraper, states

log = logging.getLogger("scheduler")

DEFAULT_INTERVAL_SECONDS = 300


def _states() -> tuple[str, ...]:
    raw = os.environ.get("SCRAPE_STATES", "")
    if not raw:
        return tuple(states.ENABLED)
    return tuple(s.strip().upper() for s in raw.split(",") if s.strip())


def _interval() -> int:
    try:
        return max(30, int(os.environ.get("SCRAPE_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS)))
    except ValueError:
        return DEFAULT_INTERVAL_SECONDS


def _scrape_on_startup() -> bool:
    return os.environ.get("SCRAPE_ON_STARTUP", "1").lower() not in {"0", "false", "no", "off"}


async def _scrape_states(states: Iterable[str]) -> None:
    for state in states:
        try:
            result = await asyncio.to_thread(scraper.scrape_state, state)
            log.info(
                "scrape %s ok: pages=%s rows=%s",
                state, result["pages_fetched"], result["rows_upserted"],
            )
        except Exception as e:
            log.warning("scrape %s failed: %s", state, e)


async def run(stop: asyncio.Event) -> None:
    states = _states()
    interval = _interval()
    log.info("scheduler started · states=%s · interval=%ss", list(states), interval)

    if _scrape_on_startup():
        await _scrape_states(states)

    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            await _scrape_states(states)

    log.info("scheduler stopped")
