"""Local production mode: the built client served by the bot itself, and a guard
that refuses any request a web page on another site could have made."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

import local_app

ORIGIN = "http://127.0.0.1:7860"


def make(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>arcade</title>")
    (dist / "assets" / "app.js").write_text("console.log('arcade')")
    app = FastAPI()

    @app.post("/start")
    async def start():
        return {"started": True}

    local_app.install(app, dist=dist, origin=ORIGIN)
    return TestClient(app, base_url=ORIGIN)


def test_the_root_opens_the_arcade(tmp_path):
    client = make(tmp_path)
    response = client.get("/", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/arcade/"


def test_the_built_client_is_served_under_arcade(tmp_path):
    client = make(tmp_path)
    assert "arcade" in client.get("/arcade/").text
    assert client.get("/arcade/assets/app.js").status_code == 200


def test_the_arcades_own_requests_are_allowed(tmp_path):
    client = make(tmp_path)
    assert client.post("/start", headers={"Origin": ORIGIN}).json() == {"started": True}
    # A navigation or a script without an Origin header is the browser's own tab.
    assert client.post("/start").status_code == 200
    assert client.get("/arcade/", headers={"Host": "localhost:7860"}).status_code == 200


def test_a_request_from_another_site_is_refused(tmp_path):
    client = make(tmp_path)
    response = client.post(
        "/start",
        headers={"Origin": "https://evil.example", "Content-Type": "text/plain"},
        content="{}",
    )
    assert response.status_code == 403


def test_a_request_under_another_host_name_is_refused(tmp_path):
    # DNS rebinding: a hostile name resolving to 127.0.0.1 arrives with its own Host.
    client = make(tmp_path)
    assert client.post("/start", headers={"Host": "evil.example:7860"}).status_code == 403


def test_a_missing_build_is_reported_not_served(tmp_path):
    app = FastAPI()
    try:
        local_app.install(app, dist=tmp_path / "nope", origin=ORIGIN)
    except local_app.LocalAppError as e:
        assert "npm run build" in str(e)
    else:
        raise AssertionError("expected LocalAppError")
