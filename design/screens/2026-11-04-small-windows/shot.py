"""Small windows (redesign 0.2.1, canvas page 7) in browser mode: the recording pill and the call
prompt in both themes. Each window is drawn at its native size on a grey backdrop.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes s7-*.png here.
The video window needs a real video file, so it is checked in the app, not here.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = [
    ("recording-pill", "&mockRecording=1", 224, 52, "pill"),
    ("meeting-prompt", "&mockCall=telemost", 520, 88, "call"),
]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE)
    for theme in ("light", "dark"):
        for name, extra, w, h, out in WINDOWS:
            # The theme is «Как в системе» by default, so the browser's scheme picks it.
            pg = b.new_page(viewport={"width": w + 80, "height": h + 60}, locale="ru-RU", color_scheme=theme)
            pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
            pg.goto(f"http://localhost:5191/?window={name}{extra}")
            pg.wait_for_timeout(3500)
            # Draw the window frame at its native size on a grey desk, like the canvas.
            pg.evaluate(
                f"""() => {{
                    document.getElementById('__vibe-mock-toolbar')?.remove()
                    const root = document.getElementById('root')
                    document.body.style.cssText = 'margin:0;background:#c9c9cf;display:grid;place-items:center;height:100vh'
                    root.style.cssText = 'width:{w}px;height:{h}px;overflow:hidden'
                    root.querySelectorAll('.h-screen').forEach((n) => (n.style.height = '{h}px'))
                    root.querySelectorAll('.w-screen').forEach((n) => (n.style.width = '{w}px'))
                }}"""
            )
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{HERE}/s7-{out}-{theme}.png")
            pg.close()
    b.close()
