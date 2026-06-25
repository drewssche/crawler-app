from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.db.models.page import Page
from app.db.models.run import Run


SEO_WEIGHTS = {
    "title": 20,
    "description": 20,
    "h1": 15,
    "canonical": 10,
    "indexability": 15,
    "lang": 5,
    "viewport": 5,
    "image_alt": 5,
    "heading_structure": 5,
}


def _normalize_url(url: str) -> str:
    clean, _ = urldefrag(url)
    return clean.strip()


def _check(
    key: str,
    label: str,
    status: str,
    message: str,
) -> dict:
    weight = SEO_WEIGHTS[key]
    points = weight if status == "pass" else weight / 2 if status == "warning" else 0
    return {
        "key": key,
        "label": label,
        "status": status,
        "message": message,
        "weight": weight,
        "points": points,
    }


def build_page_context(db: Session, run: Run, page: Page) -> dict:
    html = page.html or ""
    soup = BeautifulSoup(html, "lxml") if html else BeautifulSoup("", "lxml")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    description_tag = soup.find("meta", attrs={"name": lambda value: value and value.lower() == "description"})
    description = str(description_tag.get("content") or "").strip() if description_tag else ""
    canonical_tag = soup.find("link", attrs={"rel": lambda value: value and "canonical" in value})
    canonical = (
        _normalize_url(urljoin(page.url, str(canonical_tag.get("href") or "")))
        if canonical_tag and canonical_tag.get("href")
        else ""
    )
    robots_tag = soup.find("meta", attrs={"name": lambda value: value and value.lower() == "robots"})
    robots = str(robots_tag.get("content") or "").lower().strip() if robots_tag else ""
    lang = str(soup.html.get("lang") or "").strip() if soup.html else ""
    viewport_tag = soup.find("meta", attrs={"name": lambda value: value and value.lower() == "viewport"})
    viewport = str(viewport_tag.get("content") or "").strip() if viewport_tag else ""
    headings = [
        {"level": int(tag.name[1]), "text": tag.get_text(" ", strip=True)}
        for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
    ]
    h1_values = [heading["text"] for heading in headings if heading["level"] == 1 and heading["text"]]

    links = []
    for tag in soup.find_all("a"):
        href = str(tag.get("href") or "").strip()
        if not href:
            continue
        target = _normalize_url(urljoin(page.url, href))
        parsed = urlparse(target)
        if parsed.scheme not in {"http", "https"}:
            continue
        links.append(
            {
                "url": target,
                "text": tag.get_text(" ", strip=True)[:200],
                "internal": parsed.netloc.lower() == urlparse(page.url).netloc.lower(),
            }
        )

    run_pages = {
        _normalize_url(url): status_code
        for url, status_code in db.query(Page.url, Page.status_code).filter(Page.run_id == run.id).all()
    }
    for link in links:
        known_status = run_pages.get(link["url"])
        link["known_status"] = known_status
        link["broken"] = known_status is not None and known_status >= 400

    images = []
    for tag in soup.find_all("img"):
        src = str(tag.get("src") or "").strip()
        if not src:
            continue
        alt = tag.get("alt")
        images.append(
            {
                "url": _normalize_url(urljoin(page.url, src)),
                "alt": str(alt).strip() if alt is not None else None,
                "missing_alt": alt is None or not str(alt).strip(),
            }
        )
    scripts = [
        _normalize_url(urljoin(page.url, str(tag.get("src"))))
        for tag in soup.find_all("script")
        if tag.get("src")
    ]
    styles = [
        _normalize_url(urljoin(page.url, str(tag.get("href"))))
        for tag in soup.find_all("link")
        if tag.get("href") and "stylesheet" in [str(value).lower() for value in (tag.get("rel") or [])]
    ]

    heading_levels = [heading["level"] for heading in headings]
    heading_order_ok = all(
        current <= previous + 1
        for previous, current in zip(heading_levels, heading_levels[1:])
    )
    missing_alt = sum(1 for image in images if image["missing_alt"])
    checklist = [
        _check(
            "title",
            "Title",
            "pass" if 10 <= len(title) <= 70 else "warning" if title else "fail",
            f"Title содержит {len(title)} символов." if title else "Title отсутствует.",
        ),
        _check(
            "description",
            "Meta description",
            "pass" if 50 <= len(description) <= 180 else "warning" if description else "fail",
            f"Description содержит {len(description)} символов." if description else "Meta description отсутствует.",
        ),
        _check(
            "h1",
            "H1",
            "pass" if len(h1_values) == 1 and len(h1_values[0]) >= 3 else "warning" if h1_values else "fail",
            "Найден один содержательный H1." if len(h1_values) == 1 else f"Найдено H1: {len(h1_values)}.",
        ),
        _check(
            "canonical",
            "Canonical",
            "pass" if canonical else "fail",
            f"Canonical: {canonical}" if canonical else "Canonical отсутствует.",
        ),
        _check(
            "indexability",
            "Индексируемость",
            "fail" if "noindex" in robots else "pass",
            "Страница помечена noindex." if "noindex" in robots else "Запрета noindex не найдено.",
        ),
        _check("lang", "Язык документа", "pass" if lang else "fail", f"lang={lang}" if lang else "Атрибут lang отсутствует."),
        _check(
            "viewport",
            "Viewport",
            "pass" if viewport else "fail",
            "Viewport задан." if viewport else "Meta viewport отсутствует.",
        ),
        _check(
            "image_alt",
            "Alt изображений",
            "pass" if missing_alt == 0 else "warning" if missing_alt < len(images) else "fail",
            f"Без alt: {missing_alt} из {len(images)}.",
        ),
        _check(
            "heading_structure",
            "Структура заголовков",
            "pass" if heading_order_ok and headings else "warning" if headings else "fail",
            "Уровни заголовков идут последовательно." if heading_order_ok and headings else "Есть пропуски уровней заголовков." if headings else "Заголовки отсутствуют.",
        ),
    ]
    score = round(sum(item["points"] for item in checklist))

    return {
        "page": {
            "id": page.id,
            "run_id": run.id,
            "project_site_id": run.project_site_id,
            "url": page.url,
            "status_code": page.status_code,
            "content_type": page.content_type,
            "html_hash": page.html_hash,
        },
        "meta": {
            "title": title,
            "description": description,
            "canonical": canonical,
            "robots": robots,
            "lang": lang,
            "viewport": viewport,
            "headings": headings[:50],
        },
        "links": {
            "total": len(links),
            "internal": sum(1 for link in links if link["internal"]),
            "external": sum(1 for link in links if not link["internal"]),
            "known_broken": sum(1 for link in links if link["broken"]),
            "items": links[:100],
        },
        "assets": {
            "images": {"total": len(images), "missing_alt": missing_alt, "items": images[:100]},
            "scripts": {"total": len(scripts), "items": scripts[:100]},
            "styles": {"total": len(styles), "items": styles[:100]},
        },
        "seo": {
            "score": score,
            "grade": "good" if score >= 80 else "needs_work" if score >= 55 else "poor",
            "checklist": checklist,
            "disclaimer": "Техническая полнота страницы, а не гарантия позиций в поиске.",
        },
    }
