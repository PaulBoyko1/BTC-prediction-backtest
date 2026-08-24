from __future__ import annotations

from typing import Any

import requests

from backend.reference_sources import CMEDataMineClient, CMEDataMineCredentials


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.closed = False

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"status={self.status_code}")

    def close(self) -> None:
        self.closed = True

    def iter_content(self, chunk_size: int):
        yield b"test"


def test_cme_list_retries_once_with_fresh_token_after_401(monkeypatch):
    post_calls: list[str] = []
    get_auth_headers: list[str] = []

    def fake_post(*args, **kwargs):
        post_calls.append("post")
        token = f"token-{len(post_calls)}"
        return FakeResponse(200, {"access_token": token, "expires_in": 1800})

    def fake_get(*args, **kwargs):
        get_auth_headers.append(kwargs["headers"]["Authorization"])
        if len(get_auth_headers) == 1:
            return FakeResponse(401)
        return FakeResponse(200, {"files": [{"fid": "example"}]})

    monkeypatch.setattr("backend.reference_sources.requests.post", fake_post)
    monkeypatch.setattr("backend.reference_sources.requests.get", fake_get)

    client = CMEDataMineClient(CMEDataMineCredentials("id", "password"))
    payload = client.list_entitled_files(limit=1)

    assert payload == {"files": [{"fid": "example"}]}
    assert post_calls == ["post", "post"]
    assert get_auth_headers == ["Bearer token-1", "Bearer token-2"]


def test_cme_token_is_reused_while_not_expired(monkeypatch):
    post_calls: list[str] = []

    def fake_post(*args, **kwargs):
        post_calls.append("post")
        return FakeResponse(200, {"access_token": "stable-token", "expires_in": 1800})

    monkeypatch.setattr("backend.reference_sources.requests.post", fake_post)

    client = CMEDataMineClient(CMEDataMineCredentials("id", "password"))
    assert client.access_token() == "stable-token"
    assert client.access_token() == "stable-token"
    assert post_calls == ["post"]
