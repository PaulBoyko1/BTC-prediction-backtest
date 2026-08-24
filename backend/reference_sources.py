"""Credentialed settlement-reference acquisition helpers.

This module deliberately contains no fallback from exact reference data to exchange
spot. Callers must decide explicitly whether a study is `exact_reference`,
`exact_outcome_only`, or `spot_proxy`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


CME_AUTH_URL = "https://auth.cmegroup.com/as/token.oauth2"
CME_DOWNLOAD_URL = "https://datamine.new.cmegroup.com/cme/api/v2/download"
CME_LIST_URL = "https://datamine.new.cmegroup.com/api/list_entitlements_files"


@dataclass(frozen=True)
class CMEDataMineCredentials:
    api_id: str
    api_password: str


class CMEDataMineClient:
    """Small client for files already entitled/purchased in CME DataMine."""

    def __init__(
        self,
        credentials: CMEDataMineCredentials,
        *,
        timeout_seconds: float = 60.0,
    ) -> None:
        if not credentials.api_id or not credentials.api_password:
            raise ValueError("CME DataMine API ID and password are required")
        self.credentials = credentials
        self.timeout_seconds = timeout_seconds
        self._token: str | None = None
        self._token_expires_at_monotonic = 0.0

    def access_token(self, *, force_refresh: bool = False) -> str:
        now = time.monotonic()
        if (
            self._token
            and not force_refresh
            and now < self._token_expires_at_monotonic
        ):
            return self._token

        response = requests.post(
            CME_AUTH_URL,
            data={"grant_type": "client_credentials"},
            auth=(self.credentials.api_id, self.credentials.api_password),
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise RuntimeError("CME auth response did not contain access_token")

        expires_in = payload.get("expires_in", 1800)
        try:
            expires_seconds = max(60.0, float(expires_in))
        except (TypeError, ValueError):
            expires_seconds = 1800.0
        # Refresh before CME's documented 30-minute expiry rather than racing it.
        refresh_margin = min(60.0, expires_seconds * 0.1)
        self._token = str(token)
        self._token_expires_at_monotonic = time.monotonic() + expires_seconds - refresh_margin
        return self._token

    def _headers(self, *, force_refresh: bool = False) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token(force_refresh=force_refresh)}",
            "User-Agent": "btc-prediction-research/0.4",
        }

    def _get_with_auth_retry(self, url: str, **kwargs: Any) -> requests.Response:
        response = requests.get(
            url,
            headers=self._headers(),
            timeout=self.timeout_seconds,
            **kwargs,
        )
        if response.status_code != 401:
            return response
        response.close()
        return requests.get(
            url,
            headers=self._headers(force_refresh=True),
            timeout=self.timeout_seconds,
            **kwargs,
        )

    def list_entitled_files(self, **filters: Any) -> dict[str, Any]:
        """Query the CME DataMine List API.

        Useful filters documented by CME include category_code, dataset_code,
        period_date, limit and offset. Only files entitled to the API ID are
        returned.
        """

        params = {key: value for key, value in filters.items() if value is not None}
        response = self._get_with_auth_retry(CME_LIST_URL, params=params)
        try:
            response.raise_for_status()
            return response.json()
        finally:
            response.close()

    def download_file(
        self,
        file_id: str,
        output_path: str | Path,
        *,
        chunk_size: int = 1024 * 1024,
    ) -> Path:
        """Download one entitled DataMine file by CME file ID."""

        if not file_id:
            raise ValueError("file_id is required")
        if chunk_size <= 0:
            raise ValueError("chunk_size must be > 0")

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        response = self._get_with_auth_retry(
            CME_DOWNLOAD_URL,
            params={"fid": file_id},
            stream=True,
        )
        try:
            response.raise_for_status()
            with output.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        handle.write(chunk)
        finally:
            response.close()

        return output
