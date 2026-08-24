"""Credentialed settlement-reference acquisition helpers.

This module deliberately contains no fallback from exact reference data to exchange
spot. Callers must decide explicitly whether a study is `exact_reference`,
`exact_outcome_only`, or `spot_proxy`.
"""

from __future__ import annotations

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

    def access_token(self, *, force_refresh: bool = False) -> str:
        if self._token and not force_refresh:
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
        self._token = str(token)
        return self._token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token()}",
            "User-Agent": "btc-prediction-research/0.1",
        }

    def list_entitled_files(self, **filters: Any) -> dict[str, Any]:
        """Query the CME DataMine List API.

        Useful filters documented by CME include category_code, dataset_code,
        period_date, limit and offset. Only files entitled to the API ID are
        returned.
        """

        params = {key: value for key, value in filters.items() if value is not None}
        response = requests.get(
            CME_LIST_URL,
            headers=self._headers(),
            params=params,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return response.json()

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

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)

        with requests.get(
            CME_DOWNLOAD_URL,
            headers=self._headers(),
            params={"fid": file_id},
            timeout=self.timeout_seconds,
            stream=True,
        ) as response:
            response.raise_for_status()
            with output.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        handle.write(chunk)

        return output
