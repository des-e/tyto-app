import re
import sys

root = sys.argv[1] + "/project/"
src = open(root + "N1.dc.html", encoding="utf-8").read()

# Drop the explanatory note from N1 itself: rationale belongs in the reply, not on the artboard.
src = re.sub(r'\n  <p style="margin: 12px 8px 0 8px;[^\n]*</p>', "", src)
open(root + "N1.dc.html", "w", encoding="utf-8", newline="").write(src)

home_start = src.index('  <a href="#" style="margin-top: 10px;')
home_end = src.index("</a>", home_start) + len("</a>")
search_btn = re.search(r'    <button type="button" aria-label="Поиск".*?</button>\n', src, re.S).group(0)

PLUS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>'
ITEM = 'style="display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; font-size: 13.5px; text-align: left; cursor: pointer;"'


def icon(paths):
    return f'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg>'


MIC = icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><path d="M12 19v3"></path>')
SCREEN = icon('<rect width="20" height="14" x="2" y="3" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>')
FOLDER = icon('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"></path>')
LINK = icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>')

variants = {
    "N2": (
        "Кнопка с подписью",
        search_btn
        + f'    <button type="button" style="height: 28px; padding: 0 8px 0 6px; border: 1px solid #e1e1e1; border-radius: 6px; background: #fff; display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 500; cursor: pointer;">{PLUS}Новая</button>\n',
        "",
    ),
    "N3": (
        "«+» открывает меню",
        search_btn
        + f'    <button type="button" aria-label="Добавить" aria-expanded="true" style="width: 28px; height: 28px; border: 0; border-radius: 6px; background: #ebebeb; color: #171717; display: grid; place-items: center;">{PLUS}</button>\n',
        f'''  <div role="menu" style="position: absolute; left: 88px; top: 82px; width: 196px; padding: 4px; border: 1px solid #eaeaea; border-radius: 10px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.08); z-index: 2;">
    <button type="button" role="menuitem" {ITEM}>{MIC}Записать звонок</button>
    <button type="button" role="menuitem" {ITEM}>{SCREEN}Записать с экраном</button>
    <button type="button" role="menuitem" {ITEM}>{FOLDER}Расшифровать файл</button>
    <button type="button" role="menuitem" {ITEM}>{LINK}По ссылке</button>
  </div>
''',
    ),
    "N4": (
        "Две кнопки",
        search_btn,
        f'''  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 10px;">
    <button type="button" style="height: 32px; border: 0; border-radius: 6px; background: #171717; color: #fff; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; font-weight: 500; cursor: pointer;"><span style="width: 7px; height: 7px; border-radius: 4px; background: #ff5b4f;"></span>Записать</button>
    <button type="button" style="height: 32px; border: 1px solid #e1e1e1; border-radius: 6px; background: #fff; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; font-weight: 500; cursor: pointer;">Файл</button>
  </div>
''',
    ),
}

for name, (title, header_buttons, extra) in variants.items():
    s = src.replace("<title>«Главная» в списке</title>", f"<title>{title}</title>")
    s = s.replace(search_btn, header_buttons, 1)
    s = s[: s.index(src[home_start:home_end])] + extra.rstrip("\n") + s[s.index(src[home_start:home_end]) + (home_end - home_start):]
    if name == "N3":
        s = s.replace('<aside style="width: 232px;', '<aside style="position: relative; width: 232px;', 1)
        s = s.replace("overflow: hidden;", "")
    open(root + name + ".dc.html", "w", encoding="utf-8", newline="").write(s)
print("ok")
