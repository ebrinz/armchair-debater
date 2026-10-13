"""Local production mode: the bot serves the built arcade itself, on loopback only.

Started by the ``armchair`` launcher at the repo root. The client is built once
(``npm run build`` with ``--base=/arcade/``) and served from this process, so
there is no dev server and no second port. The runner already binds to
loopback; what this adds is a guard against the browser itself being used
against you: any page you visit can send requests to 127.0.0.1, and some
cross-site POSTs go out without a CORS preflight. So every request that names a
foreign Origin, or arrives under a foreign Host name (DNS rebinding), is refused
before it reaches /start or the WebRTC offer.
"""

from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

ARCADE_PATH = "/arcade"


class LocalAppError(RuntimeError):
    """Local mode cannot start."""


def _same_origins(origin: str) -> tuple[set[str], set[str]]:
    """The origins and Host headers that belong to this app: 127.0.0.1 and localhost."""
    port = urlsplit(origin).port
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    return {f"http://{host}" for host in hosts}, hosts


def install(app: FastAPI, *, dist: Path, origin: str) -> None:
    """Serve ``dist`` at /arcade/, send / there, and refuse foreign requests."""
    if not (dist / "index.html").is_file():
        raise LocalAppError(f"no built client at {dist}: run `npm run build` in client/")

    origins, hosts = _same_origins(origin)

    @app.middleware("http")
    async def refuse_foreign_requests(request, call_next):
        sent_origin = request.headers.get("origin")
        if sent_origin is not None and sent_origin not in origins:
            return PlainTextResponse("foreign origin", status_code=403)
        if request.headers.get("host") not in hosts:
            return PlainTextResponse("foreign host", status_code=403)
        return await call_next(request)

    # Registered before the runner's own routes, so this "/" wins over its
    # redirect to the prebuilt debugging client.
    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse(url=f"{ARCADE_PATH}/")

    app.mount(ARCADE_PATH, StaticFiles(directory=dist, html=True), name="arcade")
