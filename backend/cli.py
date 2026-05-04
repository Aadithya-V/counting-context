import argparse
import json

from . import db, scraper


def main() -> None:
    p = argparse.ArgumentParser(prog="election-dashboard")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="Create the SQLite schema")

    s = sub.add_parser("scrape", help="Scrape state pages from results.eci.gov.in")
    s.add_argument("--state", default="S22", help="State code, e.g. S22 (default)")
    s.add_argument("--max-pages", type=int, default=50)
    s.add_argument("--delay", type=float, default=0.5)

    serve = sub.add_parser("serve", help="Run the API server")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)

    sub.add_parser("mcp", help="Run the MCP server over stdio")

    args = p.parse_args()

    if args.cmd == "init":
        db.init_db()
        print(f"Initialized {db.DB_PATH}")
    elif args.cmd == "scrape":
        db.init_db()
        result = scraper.scrape_state(
            args.state, max_pages=args.max_pages, delay=args.delay
        )
        print(json.dumps(result, indent=2))
    elif args.cmd == "serve":
        import uvicorn

        uvicorn.run("backend.api:app", host=args.host, port=args.port, reload=False)
    elif args.cmd == "mcp":
        from . import mcp_server
        mcp_server.main()


if __name__ == "__main__":
    main()
