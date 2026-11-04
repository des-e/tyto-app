"""Screenshots for the public README (github.com/des-e/tyto), browser mode, without the mock's version.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes PNGs next to this file.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
CLEAN = """() => {
    document.getElementById('__vibe-mock-toolbar')?.remove()
    for (const node of document.querySelectorAll('body *')) {
        if (node.childElementCount !== 0) continue
        // Demo data reads as a real Russian workspace in the README.
        const swap = { '9.9.9-mock': '0.2.1', 'team-standup': 'Созвон с подрядчиком', 'podcast-episode': 'Интервью с кандидатом', 'legacy-interview': 'Голосовая заметка', '00:01': '48:00', '/ 00:01': '/ 48:00' }
        const text = (node.textContent || '').trim()
        if (text in swap) node.textContent = swap[text]
    }
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE)
    for theme in ("light", "dark"):
        pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2, locale="ru-RU", color_scheme=theme)
        pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
        pg.goto("http://localhost:5191/")
        pg.wait_for_timeout(5000)
        pg.evaluate(CLEAN)
        pg.get_by_text("Планерка отдела продаж", exact=True).first.click()
        pg.wait_for_timeout(1000)
        for name in ("Саммари", "Темы"):
            button = pg.get_by_role("button", name=name, exact=True)
            if button.get_attribute("aria-pressed") != "true":
                button.click()
                pg.wait_for_timeout(500)
        pg.evaluate(CLEAN)
        pg.screenshot(path=f"{HERE}/transcript-{theme}.png")
        pg.close()

    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2, locale="ru-RU")
    pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    # The one-time calls question belongs to a fresh install, not to the README.
    pg.get_by_role("button", name="Нет", exact=True).click()
    pg.wait_for_timeout(500)
    pg.evaluate(CLEAN)
    pg.screenshot(path=f"{HERE}/main-light.png")
    b.close()
