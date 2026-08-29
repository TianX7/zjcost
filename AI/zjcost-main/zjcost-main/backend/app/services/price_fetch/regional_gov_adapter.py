"""Public aggregate price adapter backed by 100njz market table."""

from __future__ import annotations

import logging
from datetime import date

import httpx
from bs4 import BeautifulSoup

from .base import BasePriceFetcher, FetchedPrice

logger = logging.getLogger(__name__)

AGGREGATE_URL = "https://www.100njz.com/aggregate/"


class RegionalGovAdapter(BasePriceFetcher):
    source_name = "regional_gov"
    display_name = "百年建筑砂石行情"

    _supported_categories = ["砂石", "骨料", "碎石", "机制砂"]

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
                url=AGGREGATE_URL,
            ))
            if len(results) >= page_size:
                break
        return results

    def _fetch_rows(self) -> list[dict[str, str | float]]:
        try:
            response = httpx.get(
                AGGREGATE_URL,
                headers={"User-Handler": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9"},
                timeout=20.0,
                follow_redirects=True,
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "lxml")
            rows = []
            for row in _pick_market_rows(soup):
                cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in row.select("td")]
                if len(cells) != 4:
                    continue
                price = _parse_price_range(cells[2])
                if price <= 0:
                    continue
                mmdd = cells[3]
                rows.append({
                    "name": cells[0] or "砂石",
                    "spec": cells[0] or "砂石",
                    "unit": "m3",
                    "unit_price": price,
                    "region": cells[1],
                    "effective_date": _to_date(mmdd),
                })
            return rows
        except Exception as exc:
            logger.warning("100njz aggregate fetch failed: %s", exc)
            return []

    def _health_check(self, timeout: float = 5.0) -> bool:
        try:
            response = httpx.get(
                AGGREGATE_URL,
                headers={"User-Handler": "Mozilla/5.0"},
                timeout=timeout,
                follow_redirects=True,
            )
            return response.status_code < 500
        except Exception:
            return False


def _parse_price_range(text: str) -> float:
    values = []
    for part in text.replace("—", "-").split("-"):
        part = part.strip().replace(",", "")
        if not part:
            continue
        try:
            values.append(float(part))
        except ValueError:
            continue
    if not values:
        return 0.0
    return round(sum(values) / len(values), 2)


def _to_date(mmdd: str) -> str:
    if len(mmdd) == 5 and "-" in mmdd:
        return f"{date.today().year}-{mmdd}"
    return date.today().isoformat()


def _pick_market_rows(soup: BeautifulSoup):
    for table in soup.select("table"):
        rows = table.select("tr")
        sample = []
        for row in rows[:4]:
            cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in row.select("td")]
            if cells:
                sample.append(cells)
        if sample and all(len(cells) == 4 for cells in sample):
            if any("-" in cells[2] for cells in sample):
                return rows
    return []
