"""全网建材价格搜索适配器：聚合多个公开价格网站的搜索结果。

支持的源：
- 百年建筑搜索（水泥/混凝土/砂石/钢材等多品类）
- 造价通搜索（综合建材信息价）
- Mysteel 钢材搜索
- 中国水泥网
- 中国混凝土网

通过统一的搜索接口，根据关键词返回全网价格信息。
"""

from __future__ import annotations

import logging
import re
from datetime import date
from urllib.parse import quote

import httpx
from bs4 import BeautifulSoup

from .base import BasePriceFetcher, FetchedPrice

logger = logging.getLogger(__name__)

# 通用 HTTP 请求头
HEADERS = {
    "User-Handler": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

# 各源搜索 URL 模板
SEARCH_ENDPOINTS = {
    "100njz": "https://www.100njz.com/search/?keyword={kw}",
    "zjtcn": "https://www.zjtcn.com/price/search/?q={kw}",
    "ccement": "https://www.ccement.com/price/search/?keyword={kw}",
    "cnrm": "https://www.cnrm.com.cn/search/?q={kw}",
}


class WebSearchAdapter(BasePriceFetcher):
    """全网建材价格搜索适配器，聚合多个公开价格网站。"""

    source_name = "web_search"
    display_name = "全网价格搜索"

    _supported_categories = [
        "钢材", "水泥", "混凝土", "砂石", "木材", "管材",
        "装饰材料", "防水材料", "保温材料", "门窗", "安装材料",
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
        page_size: int = 100,
    ) -> list[FetchedPrice]:
        keyword = (query or category or "").strip()
        if not keyword:
            # 无关键词时返回空，由调用方决定是否回退
            return []

        results: list[FetchedPrice] = []
        seen: set[tuple[str, str, str]] = set()

        # 并行从多个源搜索
        for source_key, url_template in SEARCH_ENDPOINTS.items():
            try:
                prices = self._search_source(source_key, url_template, keyword, region)
                for price in prices:
                    key = (price.name, price.spec, price.region)
                    if key in seen:
                        continue
                    seen.add(key)
                    results.append(price)
                    if len(results) >= page_size:
                        return results
            except Exception as exc:
                logger.warning("Web search %s failed for '%s': %s", source_key, keyword, exc)
                continue

        return results

    def _search_source(
        self,
        source_key: str,
        url_template: str,
        keyword: str,
        region: str,
    ) -> list[FetchedPrice]:
        """从单个源搜索价格。"""
        url = url_template.format(kw=quote(keyword))
        try:
            response = httpx.get(
                url,
                headers=HEADERS,
                timeout=15.0,
                follow_redirects=True,
            )
            if response.status_code >= 400:
                logger.debug("Source %s returned %s", source_key, response.status_code)
                return []
            html = response.text
            return self._parse_html(source_key, html, keyword, region, url)
        except Exception as exc:
            logger.debug("Source %s request failed: %s", source_key, exc)
            return []

    def _parse_html(
        self,
        source_key: str,
        html: str,
        keyword: str,
        region: str,
        url: str,
    ) -> list[FetchedPrice]:
        """解析 HTML，提取价格信息。"""
        soup = BeautifulSoup(html, "lxml")
        results: list[FetchedPrice] = []
        today = date.today().isoformat()

        # 通用解析：查找所有表格行，提取包含价格数字的行
        for table in soup.select("table"):
            rows = table.select("tr")
            for row in rows[1:]:  # 跳过表头
                cells = [
                    " ".join(cell.get_text(" ", strip=True).split())
                    for cell in row.select("td")
                ]
                if len(cells) < 3:
                    continue
                price = _extract_price(cells)
                if price <= 0:
                    continue
                name = cells[0] if cells[0] else keyword
                spec = cells[1] if len(cells) > 1 else ""
                region_text = cells[2] if len(cells) > 2 else region or "全国"
                unit = _guess_unit(name, spec)

                # 关键词过滤
                if keyword and keyword.lower() not in f"{name} {spec}".lower():
                    continue
                # 地区过滤
                if region and region not in region_text:
                    continue

                results.append(FetchedPrice(
                    name=name,
                    spec=spec,
                    unit=unit,
                    unit_price=price,
                    region=region_text,
                    effective_date=today,
                    source=self.source_name,
                    url=url,
                    raw_data={"source_site": source_key},
                ))
                if len(results) >= 30:
                    return results

        # 备用解析：查找列表项中的价格
        for item in soup.select(".price-item, .search-result, .list-item, .data-row"):
            text = item.get_text(" ", strip=True)
            price = _extract_price_from_text(text)
            if price <= 0:
                continue
            name = _extract_name(item, keyword)
            if not name:
                continue
            results.append(FetchedPrice(
                name=name,
                spec="",
                unit=_guess_unit(name, ""),
                unit_price=price,
                region=region or "全国",
                effective_date=today,
                source=self.source_name,
                url=url,
                raw_data={"source_site": source_key},
            ))
            if len(results) >= 30:
                return results

        return results

    def _health_check(self, timeout: float = 5.0) -> bool:
        """检查至少一个源是否可达。"""
        for url_template in SEARCH_ENDPOINTS.values():
            try:
                url = url_template.format(kw=quote("水泥"))
                response = httpx.get(url, headers=HEADERS, timeout=timeout, follow_redirects=True)
                if response.status_code < 500:
                    return True
            except Exception:
                continue
        return False


def _extract_price(cells: list[str]) -> float:
    """从表格单元格中提取价格。"""
    for cell in cells[1:]:
        price = _extract_price_from_text(cell)
        if price > 0:
            return price
    return 0.0


def _extract_price_from_text(text: str) -> float:
    """从文本中提取价格数字。"""
    # 匹配 "3500元/吨", "3500", "3500-3600", "3,500元" 等
    patterns = [
        r"(\d[\d,]+(?:\.\d+)?)\s*[-—~]\s*(\d[\d,]+(?:\.\d+)?)",  # 区间
        r"(\d[\d,]+(?:\.\d+)?)",  # 单个数字
    ]
    for pattern in patterns:
        matches = re.findall(pattern, text)
        if matches:
            if isinstance(matches[0], tuple):
                # 区间取平均
                low = _to_float(matches[0][0])
                high = _to_float(matches[0][1])
                if low > 0 and high > 0:
                    return round((low + high) / 2, 2)
            else:
                value = _to_float(matches[0])
                if value > 0:
                    return value
    return 0.0


def _to_float(text: str) -> float:
    cleaned = text.replace(",", "").replace("元", "").replace("/吨", "").replace("/m³", "").strip()
    try:
        return float(cleaned)
    except (TypeError, ValueError):
        return 0.0


def _extract_name(element, fallback: str) -> str:
    """从元素中提取材料名称。"""
    name_tag = element.select_one(".name, .title, .product-name, a")
    if name_tag:
        name = name_tag.get_text(strip=True)
        if name and len(name) < 50:
            return name
    return fallback


def _guess_unit(name: str, spec: str) -> str:
    """根据材料名称猜测单位。"""
    text = f"{name} {spec}".lower()
    if any(k in text for k in ["钢", "螺纹", "盘螺", "线材", "钢板", "钢管", "水泥"]):
        return "t"
    if any(k in text for k in ["混凝土", "砂", "石", "砌块", "木方"]):
        return "m³"
    if any(k in text for k in ["砖", "瓦"]):
        return "千块"
    if any(k in text for k in ["涂料", "乳胶漆", "卷材", "防水"]):
        return "m²"
    if any(k in text for k in ["管", "线", "电缆"]):
        return "m"
    if any(k in text for k in ["门", "窗"]):
        return "m²"
    return "项"
