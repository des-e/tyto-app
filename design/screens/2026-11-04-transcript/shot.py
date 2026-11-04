"""Screens of the transcript page (redesign 0.2.1, canvas page 3) in browser mode.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py` (DARK=1 for the dark
theme). Writes s3-*.png next to this file. Uses the mock project «Планерка отдела продаж».
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
TITLE = "Планерка отдела продаж"


def open_page(p, dark=False, extra_init=""):
    b = p.chromium.launch(executable_path=EXE)
    pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU", color_scheme="dark" if dark else "light")
    pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU');" + extra_init)
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
    pg.get_by_text(TITLE, exact=True).first.click()
    pg.wait_for_timeout(1200)
    return b, pg, errors


def click(pg, text, role="button"):
    pg.get_by_role(role, name=text, exact=True).first.click()
    pg.wait_for_timeout(700)


if os.environ.get("DARK"):
    with sync_playwright() as p:
        b, pg, errors = open_page(p, dark=True)
        pg.evaluate("document.documentElement.classList.add('dark')")
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{HERE}/s3-5-dark.png")
        b.close()
    raise SystemExit

with sync_playwright() as p:
    b, pg, errors = open_page(p)
    pg.screenshot(path=f"{HERE}/s3-1-plain.png")
    click(pg, "Саммари")
    click(pg, "Темы")
    pg.screenshot(path=f"{HERE}/s3-2-summary-topics.png")
    pg.get_by_role("button", name="7 участников").click()
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{HERE}/s3-3-people.png")
    pg.keyboard.press("Escape")
    click(pg, "ИИ-разбор")
    pg.screenshot(path=f"{HERE}/s3-4-review.png")
    print("errors:", errors[:6])
    b.close()
