"""Quiet first run and the one-time calls question (redesign 0.2.1, canvas page 6) in browser mode.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes s6-*.png next to
this file. The mock download takes about 3 s, so the first shot lands mid-way.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))


def page(p, dark=False):
    b = p.chromium.launch(executable_path=EXE)
    pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU", color_scheme="dark" if dark else "light")
    pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
    return b, pg


with sync_playwright() as p:
    for dark in (False, True):
        b, pg = page(p, dark)
        pg.goto("http://localhost:5191/")
        pg.wait_for_timeout(4000)
        pg.evaluate("window.history.pushState({}, '', '/setup'); window.dispatchEvent(new PopStateEvent('popstate'))")
        pg.wait_for_timeout(1600)
        pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
        pg.screenshot(path=f"{HERE}/s6-setup-{'dark' if dark else 'light'}.png")
        b.close()

    b, pg = page(p)
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
    pg.get_by_role("button", name="Новая расшифровка").first.click()
    pg.wait_for_timeout(1000)
    pg.screenshot(path=f"{HERE}/s6-calls-question.png")
    b.close()
