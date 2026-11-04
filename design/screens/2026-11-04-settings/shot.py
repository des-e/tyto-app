"""Settings sections after round 8 (redesign 0.2.1, canvas pages 5 and 8) in browser mode.

Run `npx vite --port 5191` in desktop/, then `PYTHONUTF8=1 python shot.py`. Writes set-*.png next to
this file.
"""
import os
from playwright.sync_api import sync_playwright

EXE = r"C:/Users/userpc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
# Section in the menu -> file name; "Словарь" is opened from «Распознавание».
SECTIONS = [
    ("Общие", "general"),
    ("Конфиденциальность", "privacy"),
    ("Модели", "models"),
    ("Распознавание", "recognition"),
    ("Тонкая настройка", "tuning"),
    ("Запись", "recording"),
    ("Диктовка", "dictation"),
    ("Агенты", "agents"),
    ("Для опытных", "advanced"),
]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EXE)
    pg = b.new_page(viewport={"width": 1200, "height": 860}, locale="ru-RU")
    pg.add_init_script("localStorage.setItem('PARAGLIDE_LOCALE', 'ru-RU')")
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto("http://localhost:5191/")
    pg.wait_for_timeout(5000)
    pg.evaluate("document.getElementById('__vibe-mock-toolbar')?.remove()")
    pg.get_by_text("Настройки", exact=True).first.click()
    pg.wait_for_timeout(1000)
    nav = pg.get_by_role("navigation", name="Настройки")
    for label, name in SECTIONS:
        nav.get_by_role("button", name=label, exact=True).click()
        pg.wait_for_timeout(700)
        pg.screenshot(path=f"{HERE}/set-{name}.png")
        if name == "recognition":
            pg.get_by_role("button", name="Открыть словарь").click()
            pg.wait_for_timeout(500)
            for word in ["Битрикс24", "Телемост", "ЮKassa", "Денис Елисеев", "CRM"]:
                pg.get_by_label("Новое слово").fill(word)
                pg.keyboard.press("Enter")
                pg.wait_for_timeout(150)
            pg.wait_for_timeout(400)
            pg.screenshot(path=f"{HERE}/set-dictionary.png")
            pg.get_by_role("button", name="Назад").click()
            pg.wait_for_timeout(600)
            pg.screenshot(path=f"{HERE}/set-recognition-words.png")
    print("errors:", [e for e in errors if "unhandled command" not in e][:6])
    b.close()
