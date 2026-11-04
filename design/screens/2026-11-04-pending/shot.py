"""Recording before transcription (redesign 0.2.1, canvas page 2) in browser mode.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes s2-*.png next to
this file. Uses the mock project «Запись 10∶35» (saved without text).
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))

with sync_playwright() as p:
    for dark in (False, True):
        b = p.chromium.launch(executable_path=EXE)
        pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU")
        pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
        pg.goto("http://localhost:5191/")
        pg.wait_for_timeout(5000)
        pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
        if dark:
            pg.evaluate("document.documentElement.classList.add('dark')")
        pg.get_by_text("Запись 10∶35", exact=True).first.click()
        pg.wait_for_timeout(1000)
        pg.screenshot(path=f"{HERE}/s2-{'dark' if dark else 'light'}.png")
        if not dark:
            pg.get_by_role("button", name="Еще настройки").click()
            pg.wait_for_timeout(600)
            pg.screenshot(path=f"{HERE}/s2-settings.png")
        b.close()
