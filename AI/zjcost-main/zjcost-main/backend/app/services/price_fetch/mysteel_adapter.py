"""Public steel price adapter backed by Mysteel's current search page."""

from __future__ import annotations

import logging
from datetime import date

import httpx
from bs4 import BeautifulSoup

from .base import BasePriceFetcher, FetchedPrice

logger = logging.getLogger(__name__)

SEARCH_URL = "https://search.mysteel.com/price.html"


class MysteelAdapter(BasePriceFetcher):
    source_name = "mysteel"
    display_name = "Mysteel钢材行情"

    _supported_categories = [
        "钢材", "螺纹钢", "线材", "盘螺", "热轧板卷", "冷轧板卷",
        "中厚板", "型钢", "工字钢", "角钢", "槽钢", "无缝管",
        "焊管", "结构钢", "管坯",
    ]

    @property
    def supported_regions(self) -> list[str]:
        return []

    @property
    def supported_categories(self) -> list[str]:
        return list(self._supported_categories)

    def fetch(
        self,
        query: str | None = None,
        region: str = "",
        category: str = "",
        page: int = 1,
        page_size: int = 50,
    ) -> list[FetchedPrice]:
        rows = self._fetch_rows()
        keyword = (query or category or "").strip().lower()
        results: list[FetchedPrice] = []

        for item in rows:
            haystack = f"{item['name']} {item['spec']} {item['region']}".lower()
            if keyword and keyword not in haystack:
                continue
            if region and region not in item["region"]:
                continue
            results.append(FetchedPrice(
                name=item["name"],
                spec=item["spec"],
                unit=item["unit"],
                unit_price=item["unit_price"],
                region=item["region"],
                effective_date=item["effective_date"],
                source=self.source_name,
                url=SEARCH_URL,
            ))
            if len(results) >= page_size:
                break

        return results

    def _fetch_rows(self) -> list[dict[str, str | float]]:
        try:
            response = httpx.get(
                SEARCH_URL,
                headers={
                    "User-Handler": "Mozilla/5.0",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                },
                timeout=20.0,
                follow_redirects=True,
            )
            response.raise_for_status()
            html = response.text
            soup = BeautifulSoup(html, "lxml")
            table_rows = soup.select("table tr")
            today_year = date.today().year
            results: list[dict[str, str | float]] = []

            for row in table_rows[1:]:
                cells = [
                    " ".join(cell.get_text(" ", strip=True).split())
                    for cell in row.select("td")
                ]
                if len(cells) < 5:
                    continue
                price = _safe_float(cells[2])
                if price <= 0:
                    continue
                mmdd = cells[4]
                effective_date = (
                    f"{today_year}-{mmdd}"
                    if len(mmdd) == 5 and "-" in mmdd
                    else date.today().isoformat()
                )
                name = cells[0].strip()
                results.append({
                    "name": name,
                    "spec": name,
                    "unit": "t",
                    "unit_price": price,
                    "region": cells[1].strip(),
                    "effective_date": effective_date,
                })

            return results
        except Exception as exc:
            logger.warning("Mysteel public fetch failed: %s", exc)
            return []

    def _health_check(self, timeout: float = 5.0) -> bool:
        try:
            response = httpx.get(
                SEARCH_URL,
                headers={"User-Handler": "Mozilla/5.0"},
                timeout=timeout,
                follow_redirects=True,
            )
            return response.status_code < 500
        except Exception:
            return False


def _safe_float(text: str) -> float:
    cleaned = (
        text.replace(",", "")
        .replace("元", "")
        .replace("/吨", "")
        .replace("吨", "")
        .strip()
    )
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return 0.0
