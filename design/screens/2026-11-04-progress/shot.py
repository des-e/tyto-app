"""Screens of transcription progress (redesign 0.2.1, canvas page 4) in browser mode.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes s4-*.png next to
this file: one file running (variant A), several files (variant C) and one of them opened.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))


def run(p, files, out, wait_ms, then=None):
    b = p.chromium.launch(executable_path=EXE)
    pg = b.new_page(viewport={"width": 1200, "height": 800}, locale="ru-RU")
    multi = "off" if files == 1 else "on"
    pg.add_init_script(f"localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU'); localStorage.setItem('mock-dialog-multi', '{multi}')")
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
    pg.get_by_role("button", name="Выбрать файл").first.click()
    pg.wait_for_timeout(wait_ms)
    pg.screenshot(path=f"{HERE}/{out}")
    if then:
        then(pg)
    b.close()
    return errors


def open_first_done(pg):
    pg.wait_for_timeout(2500)
    pg.get_by_role("listitem").first.get_by_role("button").click()
    pg.wait_for_timeout(800)
    pg.screenshot(path=f"{HERE}/s4-3-batch-file-open.png")


with sync_playwright() as p:
    print(run(p, 1, "s4-1-single.png", 2600)[:4])
    print(run(p, 3, "s4-2-batch.png", 6500, open_first_done)[:4])
