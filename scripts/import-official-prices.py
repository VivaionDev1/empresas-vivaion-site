#!/usr/bin/env python3
"""Read the deployed institutional course pages and snapshot cash prices only."""
from __future__ import annotations

import html.parser
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data/catalog-v1.json"
OUTPUT_PATH = ROOT / "data/prices-v1.json"
OFFICIAL_DIST = Path("/var/www/vivaion.com.br/dist")
BRASILIA = ZoneInfo("America/Sao_Paulo")


class Element:
    def __init__(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tag = tag
        self.attrs = dict(attrs)
        self.children: list[Element | str] = []

    def text(self) -> str:
        return " ".join(" ".join(child.text().split()) if isinstance(child, Element) else child for child in self.children)


class PageParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.root = Element("root", [])
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element = Element(tag, attrs)
        self.stack[-1].children.append(element)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(element)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if self.stack[-1].tag not in {"script", "style"}:
            self.stack[-1].children.append(data)


def walk(element: Element):
    for child in element.children:
        if isinstance(child, Element):
            yield child
            yield from walk(child)


def to_cents(value: str) -> int | None:
    value = value.strip().replace("R$", "").strip()
    if re.fullmatch(r"\d+(?:\.\d{1,2})?", value):
        amount = float(value)
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})*,\d{2}", value):
        amount = float(value.replace(".", "").replace(",", "."))
    else:
        return None
    cents = round(amount * 100)
    return cents if cents > 0 else None


def campaign_expiry(page_text: str, now: datetime) -> datetime | None:
    found = re.search(r"Até\s+(\d{1,2})/(\d{1,2}),\s*(\d{1,2}):(\d{2})", page_text, re.IGNORECASE)
    if not found:
        return None
    day, month, hour, minute = map(int, found.groups())
    try:
        expiry = datetime(now.year, month, day, hour, minute, tzinfo=BRASILIA).astimezone(timezone.utc)
    except ValueError:
        return None
    return expiry if expiry > now else None


def official_cash_price(elements: list[Element]) -> int | None:
    # Stable product data attributes, excluding installment values.
    for element in elements:
        attrs = element.attrs
        if attrs.get("data-payment-type") == "avista" and attrs.get("data-value"):
            result = to_cents(attrs["data-value"] or "")
            if result:
                return result
    for element in elements:
        attrs = element.attrs
        if attrs.get("data-course-price") == "true" and attrs.get("data-value"):
            result = to_cents(attrs["data-value"] or "")
            if result:
                return result
        if attrs.get("data-offer-type") in {"formacao", "curso-livre"} and attrs.get("data-payment-type") in {"avista", "à vista"}:
            result = to_cents(attrs.get("data-value") or "")
            if result:
                return result

    for element in elements:
        attrs = element.attrs
        text = " ".join(element.text().split())
        if len(text) > 480 or "R$" not in text:
            continue
        cls = attrs.get("class", "")
        if "eureka" in cls:
            continue
        if "À vista" in text or "à vista" in text:
            match = re.search(r"À vista[^R]{0,32}R\$\s*([\d.,]+)|R\$\s*([\d.,]+)[^R]{0,18}à vista", text, re.IGNORECASE)
            if match:
                result = to_cents(match.group(1) or match.group(2) or "")
                if result:
                    return result

    for element in elements:
        cls = element.attrs.get("class", "")
        text = " ".join(element.text().split())
        if "formation-card__price" in cls and "R$" in text:
            # Standalone products show one amount here; multi-payment products
            # are handled by the explicit à-vista parser above.
            match = re.search(r"R\$\s*([\d.,]+)", text)
            if match:
                result = to_cents(match.group(1))
                if result:
                    return result
    return None


def current_cash_promo(elements: list[Element], expiry: datetime | None) -> int | None:
    if not expiry:
        return None
    for element in elements:
        cls = element.attrs.get("class", "")
        text = " ".join(element.text().split())
        if "eureka-black-card__offer" in cls and text.lower().startswith("à vista"):
            match = re.search(r"Por\s*R\$\s*([\d.,]+)", text, re.IGNORECASE)
            if match:
                return to_cents(match.group(1))
    for element in elements:
        cls = element.attrs.get("class", "")
        if not any(name in cls for name in ("eureka-hero-offer", "eureka-formation")):
            continue
        text = " ".join(element.text().split())
        match = re.search(r"por\s*R\$\s*([\d.,]+)", text, re.IGNORECASE)
        if match:
            return to_cents(match.group(1))
    return None


def main() -> None:
    now = datetime.now(timezone.utc)
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    rows = []
    for product in catalog["products"]:
        if product["commercialStage"] != "available":
            continue
        relative_path = urlparse(product["canonicalUrl"]).path.strip("/")
        page_path = OFFICIAL_DIST / relative_path / "index.html"
        if not page_path.is_file():
            raise SystemExit(f"Official page missing for {product['id']}")
        parser = PageParser()
        parser.feed(page_path.read_text(encoding="utf-8", errors="replace"))
        elements = list(walk(parser.root))
        page_text = " ".join(parser.root.text().split())
        expiry = campaign_expiry(page_text, now)
        regular = official_cash_price(elements)
        promo = current_cash_promo(elements, expiry)
        selected = promo or regular
        if not selected:
            raise SystemExit(f"Could not verify an à-vista price for {product['id']}")
        rows.append({
            "productId": product["id"],
            "unitPriceCents": selected,
            "priceLabel": "Preço promocional à vista" if promo else "Preço à vista",
            "sourceUrl": product["canonicalUrl"],
            "validUntil": expiry.isoformat().replace("+00:00", "Z") if promo else (now + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
        })
    if len(rows) != sum(1 for item in catalog["products"] if item["commercialStage"] == "available"):
        raise SystemExit("Price snapshot does not cover every available product")
    payload = {"schemaVersion": 1, "sourceCheckedAt": now.isoformat().replace("+00:00", "Z"), "prices": rows}
    temp = OUTPUT_PATH.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT_PATH)
    print(f"Imported {len(rows)} current official cash prices; {sum(row['priceLabel'].startswith('Preço promocional') for row in rows)} active promotions.")


if __name__ == "__main__":
    main()
