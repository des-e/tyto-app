"""Denis's three fixes after design1 (2026-11-04): settings menu groups, topics column times, export
«ИИ-разбор». Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE)
    pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU")
    pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")

    pg.get_by_text("Настройки", exact=True).first.click()
    pg.wait_for_timeout(900)
    pg.screenshot(path=f"{HERE}/fix-1-settings-menu.png")
    pg.reload()
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")

    pg.get_by_text("Планерка отдела продаж", exact=True).first.click()
    pg.wait_for_timeout(1000)
    for name in ("Саммари", "Темы"):
        button = pg.get_by_role("button", name=name, exact=True)
        if button.get_attribute("aria-pressed") != "true":
            button.click()
            pg.wait_for_timeout(500)
    pg.screenshot(path=f"{HERE}/fix-3-topics.png")

    pg.get_by_role("button", name="Экспорт").first.click()
    pg.wait_for_timeout(900)
    pg.screenshot(path=f"{HERE}/fix-2-export.png")
    pg.get_by_role("radio", name="ИИ-разбор").check(force=True)
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{HERE}/fix-2-export-ai.png")
    b.close()
