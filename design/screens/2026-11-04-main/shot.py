"""Main window (redesign 0.2.1, canvas page 1, variant C) in browser mode, light and dark.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes s1-*.png here.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE)
    for theme in ("light", "dark"):
        pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU", color_scheme=theme)
        pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
        pg.goto("http://localhost:5191/")
        pg.wait_for_timeout(5000)
        pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
        pg.screenshot(path=f"{HERE}/s1-main-{theme}.png")
        pg.close()
    b.close()
