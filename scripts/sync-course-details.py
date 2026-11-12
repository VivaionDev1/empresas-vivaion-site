#!/usr/bin/env python3
"""Export public academic details from the deployed Vivaion course pages.

Only module titles/descriptions and public faculty names are copied. Prices and
payment/checkout URLs stay on each official Vivaion course page.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


SITE_DIST = Path(os.environ.get("VIVAION_SITE_DIST", "/var/www/vivaion.com.br/dist"))
FEED_PATH = Path(os.environ.get("VIVAION_CATALOG_FEED", SITE_DIST / "integracoes/empresas/catalogo/v1.json"))
OUTPUT = Path(os.environ.get("VIVAION_COURSE_DETAILS_OUTPUT", Path(__file__).resolve().parent.parent / "data/course-details.json"))
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
GENERIC_HEADING = re.compile(r"módulos?|matriz|grade curricular|conteúdo programático|corpo docente|professores?|docentes?|coordenação", re.I)
FACULTY_HEADING = re.compile(r"corpo docente|professores?|docentes?|coordenação|formação acadêmica|trajetória profissional|conheça|quem sustenta|aprenda com|docente|profissionais apresentados|perspectivas profissionais|profissionais para|de alto nível|docentes selecionados", re.I)
FACULTY_MARKER = re.compile(r"professor|docent|teacher|faculty|leader", re.I)
MODULE_MARKER = re.compile(r"modul|matriz|curr[ií]cul|grade", re.I)


class Element:
    def __init__(self, tag: str, attrs: list[tuple[str, str | None]], parent: "Element | None" = None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children: list[Element | str] = []

    def text(self) -> str:
        value = " ".join(child.text() if isinstance(child, Element) else child for child in self.children)
        return re.sub(r"\s+", " ", value).strip()

    def descendants(self):
        yield self
        for child in self.children:
            if isinstance(child, Element):
                yield from child.descendants()


class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("document", [])
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(element)
        if tag not in VOID:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Element(tag, attrs, self.stack[-1]))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def classes(element: Element) -> str:
    return str(element.attrs.get("class", ""))


def section_kind(element: Element, marker: re.Pattern[str]) -> bool:
    if element.tag != "section":
        return False
    identity = str(element.attrs.get("id", "")) + " " + classes(element)
    data_marker = "data-postgraduate-teachers" if marker is FACULTY_MARKER else "data-postgraduate-modules"
    return data_marker in element.attrs or bool(marker.search(identity))


def selected_sections(root: Element, marker: re.Pattern[str]) -> list[Element]:
    candidates = [node for node in root.descendants() if section_kind(node, marker)]
    return candidates


def text_blocks(section: Element, kind: str) -> list[dict[str, str]]:
    names: list[dict[str, str]] = []
    seen: set[str] = set()
    descendants = list(section.descendants())
    if kind == "module":
        recorded_cards = [node for node in descendants if "pg-recorded-module__title" in classes(node)]
        if recorded_cards:
            candidates = recorded_cards
        else:
            card_headings = []
            h3_headings = []
            h4_card_headings = []
            for node in descendants:
                if node.tag not in {"h3", "h4", "strong"}:
                    continue
                if node.tag == "h3" and node.text() and not GENERIC_HEADING.search(node.text()):
                    h3_headings.append(node)
                ancestor = node.parent
                while ancestor is not None and ancestor is not section:
                    if re.search(r"module-card|module__card|curriculum-card", classes(ancestor), re.I):
                        card_headings.append(node)
                        if node.tag == "h4":
                            h4_card_headings.append(node)
                        break
                    ancestor = ancestor.parent
            candidates = h3_headings or h4_card_headings or card_headings
            if not candidates:
                candidates = [node for node in descendants if node.tag == "strong" and node.text() and not GENERIC_HEADING.search(node.text())]
    else:
        candidates = [node for node in descendants if node.tag == "h3"]
        if not candidates:
            candidates = [node for node in descendants if node.tag == "h2"]
    for node in candidates:
        value = node.text()
        if not value or len(value) > 240:
            continue
        if kind == "faculty":
            value = re.sub(r"^(?:Prof\.?\s*(?:Dra?\.?\s*)?|Profa\.?\s*(?:Dra?\.?\s*)?|Professor(?:a)?\s+(?:Dra?\.?\s*)?)", "", value, flags=re.I).strip()
            if len(value.split()) < 2 or FACULTY_HEADING.search(value):
                continue
        elif GENERIC_HEADING.search(value):
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        entry = {"title" if kind == "module" else "name": value}
        if kind == "module":
            ancestor = node.parent
            while ancestor is not None and ancestor is not section:
                ancestor_class = classes(ancestor)
                if ancestor.tag in {"article", "details", "li"} or re.search(r"module|curriculum|matrix|lesson", ancestor_class, re.I):
                    paragraphs = [part.text() for part in ancestor.descendants() if part.tag == "p" and part.text()]
                    description = next((p for p in paragraphs if len(p) > 30), "")
                    if description:
                        entry["description"] = description[:1200]
                    break
                ancestor = ancestor.parent
        names.append(entry)
    return names


def page_details(product: dict, site_dist: Path) -> dict:
    parsed = urlparse(product["canonicalUrl"])
    if parsed.scheme != "https" or parsed.hostname not in {"vivaion.com.br", "www.vivaion.com.br"}:
        raise ValueError(f"Untrusted canonical URL: {product['id']}")
    relative = parsed.path.strip("/")
    page = site_dist / relative / "index.html"
    if not page.is_file():
        raise FileNotFoundError(f"Official course page missing for {product['id']}: {page}")
    parser = TreeParser()
    parser.feed(page.read_text(encoding="utf-8", errors="replace"))
    modules = []
    for section in selected_sections(parser.root, MODULE_MARKER):
        for entry in text_blocks(section, "module"):
            if entry["title"].casefold() not in {item["title"].casefold() for item in modules}:
                modules.append(entry)
    professors = []
    for section in selected_sections(parser.root, FACULTY_MARKER):
        for entry in text_blocks(section, "faculty"):
            if entry["name"].casefold() not in {item["name"].casefold() for item in professors}:
                professors.append(entry)
    # Some launch pages introduce faculty as named portrait alternatives rather
    # than a teacher section; these are still public, explicit faculty credits.
    if not professors:
        for node in parser.root.descendants():
            if node.tag != "article" or "leader-card" not in classes(node):
                continue
            name = next((part.text() for part in node.descendants() if part.tag == "h4" and part.text()), "")
            name = re.sub(r"^(?:Dr\.?\s+|Dra\.?\s+|Prof\.?\s+)", "", name.strip(), flags=re.I)
            if name and name.casefold() not in {item["name"].casefold() for item in professors}:
                professors.append({"name": name})
    return {"modules": modules, "professors": professors}


def main():
    feed = json.loads(FEED_PATH.read_text(encoding="utf-8"))
    products = feed.get("products")
    if not isinstance(products, list) or not products:
        raise ValueError("Official catalog is empty or malformed")
    courses = {product["id"]: page_details(product, SITE_DIST) for product in products}
    payload = {"schemaVersion": 1, "source": "official Vivaion public course pages", "generatedAt": datetime.now(timezone.utc).isoformat(), "courses": courses}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    module_count = sum(bool(course["modules"]) for course in courses.values())
    faculty_count = sum(bool(course["professors"]) for course in courses.values())
    print(f"Exported details for {len(courses)} courses; modules present for {module_count}; faculty present for {faculty_count}.")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()
