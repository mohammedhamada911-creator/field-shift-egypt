"""Browser smoke check for the current farmer-facing application.

Start ``python app.py`` first, then run ``python scripts/browser_check.py``.
The check exercises both languages, every primary view, and a narrow viewport.
"""
from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "evidence"
URL = "http://127.0.0.1:8000/"
VIEWS = ("farm", "climate", "crops", "rotation", "plan", "help")


def main() -> None:
    errors: list[str] = []
    report: dict = {"url": URL, "views": [], "languages": {}, "mobile": {}}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda error: errors.append(str(error)))

        response = page.goto(URL, wait_until="networkidle", timeout=30_000)
        assert response and response.status == 200, "application did not return HTTP 200"
        assert page.locator("[data-view-link]").count() == len(VIEWS)
        assert page.locator("#farm-map").count() == 1

        for language, selector, expected in (
            ("ar", "#lang-mixed", "أرضي"),
            ("en", "#lang-en", "My Farm"),
        ):
            page.locator(selector).click()
            page.wait_for_function(
                "expected => document.querySelector('#farm-title')?.textContent.trim() === expected",
                arg=expected,
            )
            report["languages"][language] = page.locator("#farm-title").inner_text()

        for view in VIEWS:
            page.locator(f'[data-view-link="{view}"]').click()
            assert page.locator(f"#view-{view}").is_visible(), f"{view} view did not open"
            credit = page.locator(f"#view-{view} .developer-credit")
            assert credit.count() == 1 and credit.inner_text() == "Developed by Muhammad Yamany", (
                f"developer credit missing from {view} view"
            )
            report["views"].append({"name": view, "developerCredit": True})

        page.set_viewport_size({"width": 390, "height": 844})
        page.locator('[data-view-link="farm"]').click()
        page.wait_for_timeout(150)
        page.locator('#view-farm summary[data-i18n="px.farm.water.details"]').click()
        assert page.locator("#farm-water-source").is_visible()
        page.locator('#view-farm summary[data-i18n="px.farm.crops.details"]').click()
        assert page.locator("#farm-current-crop").is_visible()
        report["mobile"] = page.evaluate(
            """() => ({
                viewportWidth: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            })"""
        )
        assert not report["mobile"]["horizontalOverflow"], "mobile layout overflows horizontally"
        assert not errors, f"browser JavaScript errors: {errors}"

        report["pageErrors"] = errors
        report["status"] = "passed"
        EVIDENCE.mkdir(exist_ok=True)
        page.screenshot(path=str(EVIDENCE / "current-browser-smoke.png"), full_page=True)
        (EVIDENCE / "current-browser-check.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
