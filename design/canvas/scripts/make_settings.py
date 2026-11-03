"""Settings sections for the canvas, style B: groups in white frames on grey, Geist greys.

Each section is a list of groups; a group is a list of rows. A row is (label, description, control).
Controls: ("on",), ("off",), ("select", value), ("button", text), ("danger", text),
("seg", [options], selected_index), ("value", text), ("link", text), ("field", text).
"""
import json
import sys

root = sys.argv[1] + "/project/"

SECTIONS = [
    ("SetGeneral", "Общие", [
        ("Внешний вид", [
            ("Язык интерфейса", "", ("select", "Русский")),
            ("Тема", "", ("seg", ["Светлая", "Темная", "Как в системе"], 2)),
        ]),
        ("Работа в фоне", [
            ("Не закрываться, а прятаться в трей", "Tyto продолжит предлагать запись звонков. Выйти можно из значка в трее", ("on",)),
            ("Запускать вместе с компьютером", "Чтобы не пропустить звонок с утра", ("off",)),
            ("Не давать компьютеру засыпать во время работы", "Пока идет запись или расшифровка. Ноутбук разряжается быстрее", ("on",)),
        ]),
        ("О Tyto", [
            ("Версия 0.2.1", "Обновления приходят сами", ("button", "Проверить обновления")),
            ("Сообщить о проблеме", "Откроет страницу на GitHub", ("link", "Открыть")),
        ]),
    ]),
    ("SetPrivacy", "Конфиденциальность", [
        ("Записи", [
            ("Где хранятся записи", "Документы / Tyto", ("button", "Изменить папку")),
            ("Сохранять записи и расшифровки", "Если выключить, расшифровка исчезнет после закрытия Tyto", ("on",)),
        ]),
        ("Что уходит в интернет", [
            ("Расшифровка", "Никогда. Звук и текст остаются на этом компьютере", ("value", "")),
            ("Саммари, темы и ИИ-разбор", "Только если подключен ИИ-ассистент через сервис. Через Ollama текст не уходит", ("value", "")),
            ("Анонимная статистика ошибок", "Помогает быстрее находить сбои. Без текстов, имен и файлов", ("on",)),
        ]),
        ("", [
            ("Политика конфиденциальности", "", ("link", "Открыть")),
        ]),
    ]),
    ("SetRecognition", "Распознавание", [
        ("Расшифровка", [
            ("Язык встреч по умолчанию", "Можно поменять у каждой записи", ("select", "Русский")),
            ("Разделять текст по говорящим", "Кто что сказал. Различает до 4 человек", ("on",)),
            ("Словарь", "12 слов: имена, названия компаний, термины. Tyto будет писать их правильно", ("button", "Открыть словарь")),
        ]),
        ("Когда расшифровка готова", [
            ("Звуковой сигнал", "", ("on",)),
            ("Показать окно Tyto", "", ("off",)),
            ("Сохранять файлом автоматически", "Word и TXT рядом с записью", ("button", "Настроить")),
        ]),
        ("Опасная зона", [
            ("Удалить все записи", "48 записей и их расшифровки. Отменить нельзя", ("danger", "Удалить все")),
        ]),
    ]),
    ("SetModels", "Модели", [
        ("Модель распознавания", [
            ("Whisper Large v3 Turbo", "1,6 ГБ · быстрая и точная, подходит большинству", ("radio_on",)),
            ("Whisper Large v3", "3,1 ГБ · точнее на сложных записях, в 2 раза медленнее", ("radio_off",)),
            ("Whisper Medium", "1,5 ГБ · для слабых компьютеров", ("radio_off_dl", "Скачать")),
        ]),
        ("Компьютер", [
            ("Чем расшифровывать", "Видеокарта работает в несколько раз быстрее", ("seg", ["Видеокарта", "Процессор"], 0)),
            ("Папка с моделями", "AppData / Tyto / models · 1,8 ГБ", ("button", "Изменить")),
        ]),
        ("", [
            ("Своя модель по ссылке", "Файл .bin в формате ggml", ("link", "Вставить ссылку")),
        ]),
    ]),
    ("SetTuning", "Тонкая настройка", [
        ("Точность", [
            ("Точное время каждой реплики", "Нужно для субтитров. Расшифровка идет в 4 раза дольше", ("off",)),
            ("Время каждого слова", "Для экспорта в JSON и подробных субтитров", ("off",)),
        ]),
        ("Звук", [
            ("Выравнивать громкость", "Помогает, когда один говорит тихо. Добавляет до 8 минут на час записи", ("off",)),
        ]),
        ("", [
            ("Параметры Whisper и FFmpeg", "Для тех, кто знает, что это. По умолчанию подходят большинству записей", ("link", "Открыть в «Для опытных»")),
        ]),
    ]),
    ("SetDictation", "Диктовка", [
        ("Включение", [
            ("Диктовка по сочетанию клавиш", "Говорите в любом приложении, текст появится там же", ("on",)),
            ("Сочетание клавиш", "", ("value", "Ctrl + Shift + Пробел")),
            ("Как включать", "", ("seg", ["Удерживать", "Нажимать"], 0)),
        ]),
        ("Текст", [
            ("Куда девать текст", "«Вписать»: текст сам появится там, где мигает курсор. «Скопировать»: вставите сами через Ctrl+V", ("seg", ["Вписать", "Скопировать"], 0)),
            ("В одну строку", "Убирать переносы и лишние пробелы", ("on",)),
            ("Причесывать с помощью ИИ", "Расставит знаки и уберет «эээ». Нужен ИИ-ассистент", ("off",)),
            ("Показывать индикатор", "Маленькая плашка, пока Tyto слушает", ("on",)),
        ]),
    ]),
    ("SetAI", "ИИ-ассистент", [
        ("Подключение", [
            ("Где работает ИИ", "", ("seg", ["На компьютере", "Через сервис"], 1)),
            ("Сервис", "Текст расшифровки отправляется в выбранный сервис", ("select", "Claude")),
            ("Ключ", "Взять ключ на сайте сервиса", ("field", "sk-ant-••••••••••••3f9a")),
            ("Модель", "", ("select", "claude-sonnet-5-5")),
            ("Проверить подключение", "Работает · 640 мс", ("button", "Проверить")),
        ]),
        ("Что делает", [
            ("Саммари и темы для каждой новой записи", "Старые записи не трогает", ("on",)),
            ("Шаблоны ИИ-разбора", "Планерка, собеседование, продажа", ("button", "Настроить")),
        ]),
        ("Расходы", [
            ("Потрачено в этом месяце", "", ("value", "$1,24")),
            ("Лимит в месяц", "Tyto остановится, когда дойдет до лимита", ("field", "$10")),
        ]),
    ]),
    ("SetAgents", "Агенты", [
        ("Доступ для программ", [
            ("Разрешить программам работать с Tyto", "Агенты и скрипты на этом компьютере смогут расшифровывать файлы и читать ваши записи. Из интернета недоступно", ("off",)),
            ("Адрес", "Для своих скриптов", ("value", "http://127.0.0.1:8471")),
        ]),
        ("Научить агента пользоваться Tyto", [
            ("Claude Code", "Положит инструкцию в папку навыков Claude Code", ("button", "Установить")),
            ("Codex", "Положит инструкцию в папку навыков Codex", ("button", "Установить")),
            ("Другой агент", "Cursor, Gemini CLI и другие: вставьте инструкцию в их настройки", ("button", "Скопировать инструкцию")),
            ("Пример запроса агенту", "«Подведи итоги моей последней встречи в Tyto»", ("value", "")),
        ]),
    ]),
    ("SetAdvanced", "Для опытных", [
        ("Whisper", [
            ("Стратегия поиска", "Beam Search точнее, Greedy быстрее", ("seg", ["Beam Search", "Greedy"], 0)),
            ("Размер beam", "", ("field", "5")),
            ("Температура", "", ("field", "0,0")),
            ("Потоки процессора", "", ("field", "4")),
            ("Своя команда FFmpeg", "", ("field", "-af loudnorm")),
        ]),
        ("Работа программы", [
            ("Выгружать модель из памяти", "Через сколько минут простоя. 0 значит никогда", ("field", "10")),
            ("Набор инструкций процессора", "«Базовый», если расшифровка падает с ошибкой", ("select", "Автоматически")),
        ]),
        ("Если что-то сломалось", [
            ("Логи", "", ("button", "Скопировать")),
            ("Папка с логами и временные файлы", "", ("link", "Открыть")),
            ("Сбросить все настройки", "Записи останутся", ("danger", "Сбросить")),
        ]),
    ]),
]


def control(c):
    kind = c[0]
    if kind in ("on", "off"):
        on = kind == "on"
        return (f'<span role="switch" aria-checked="{str(on).lower()}" style="width: 36px; height: 20px; flex-shrink: 0; border-radius: 10px; background: {"#171717" if on else "#e1e1e1"}; '
                f'padding: 2px; box-sizing: border-box; display: flex; justify-content: {"flex-end" if on else "flex-start"};"><span style="width: 16px; height: 16px; border-radius: 8px; background: #fff;{"" if on else " box-shadow: 0 1px 2px rgba(0,0,0,0.2);"}"></span></span>')
    if kind == "select":
        return (f'<span style="height: 32px; min-width: 150px; flex-shrink: 0; box-sizing: border-box; border: 1px solid #e1e1e1; border-radius: 8px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; background: #fff;">{c[1]}'
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></span>')
    if kind == "button":
        return f'<button type="button" style="height: 32px; flex-shrink: 0; padding: 0 12px; border: 1px solid #e1e1e1; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 500;">{c[1]}</button>'
    if kind == "danger":
        return f'<button type="button" style="height: 32px; flex-shrink: 0; padding: 0 12px; border: 1px solid #f0c9c4; border-radius: 8px; background: #fff; color: #b4453c; font-size: 13px; font-weight: 500;">{c[1]}</button>'
    if kind == "seg":
        opts, sel = c[1], c[2]
        items = "".join(
            f'<span style="height: 28px; padding: 0 11px; border-radius: 6px; display: flex; align-items: center; font-size: 12.5px; {"background: #fff; box-shadow: 0 0 0 1px #e1e1e1; font-weight: 500;" if i == sel else "color: #666;"}">{o}</span>'
            for i, o in enumerate(opts))
        return f'<span role="radiogroup" style="display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f2f2f2; flex-shrink: 0;">{items}</span>'
    if kind == "value":
        return f'<span style="flex-shrink: 0; font-size: 13px; color: #666; font-family: \'Geist Mono\', monospace;">{c[1]}</span>' if c[1] else ""
    if kind == "link":
        return f'<span style="flex-shrink: 0; font-size: 13px; text-decoration: underline; text-decoration-color: #d4d4d4; text-underline-offset: 3px;">{c[1]}</span>'
    if kind == "field":
        return f'<span style="height: 32px; width: 200px; flex-shrink: 0; box-sizing: border-box; border: 1px solid #e1e1e1; border-radius: 8px; padding: 0 10px; display: flex; align-items: center; font-size: 13px; color: #444; background: #fff; overflow: hidden; white-space: nowrap;">{c[1]}</span>'
    if kind.startswith("radio"):
        on = kind == "radio_on"
        dot = f'<span style="width: 16px; height: 16px; flex-shrink: 0; border-radius: 8px; box-sizing: border-box; border: {"5px solid #171717" if on else "1.5px solid #c9c9c9"};"></span>'
        extra = f'<button type="button" style="height: 28px; padding: 0 10px; border: 1px solid #e1e1e1; border-radius: 6px; background: #fff; font-size: 12.5px;">{c[1]}</button>' if len(c) > 1 else ""
        return ("RADIO", dot, extra)
    raise ValueError(kind)


def row(label, desc, c, first):
    ctl = control(c)
    border = "" if first else "border-top: 1px solid #f0f0f0;"
    d = f'<div style="font-size: 12.5px; color: #666; margin-top: 2px; line-height: 1.45;">{desc}</div>' if desc else ""
    if isinstance(ctl, tuple):
        _, dot, extra = ctl
        return (f'<div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; {border}">{dot}'
                f'<div style="flex: 1; min-width: 0;"><div style="font-size: 14px; font-weight: 500;">{label}</div>{d}</div>{extra}</div>')
    return (f'<div style="display: flex; align-items: center; gap: 16px; padding: 12px 16px; {border}">'
            f'<div style="flex: 1; min-width: 0;"><div style="font-size: 14px; font-weight: 500;">{label}</div>{d}</div>{ctl}</div>')


def board(name, title, groups):
    parts = []
    for gtitle, rows in groups:
        if gtitle:
            parts.append(f'<h2 style="margin: 20px 0 8px 4px; font-size: 12px; font-weight: 500; color: {"#b4453c" if gtitle == "Опасная зона" else "#666"};">{gtitle}</h2>')
        else:
            parts.append('<div style="height: 16px;"></div>')
        parts.append('<section style="border: 1px solid #eaeaea; border-radius: 12px; background: #fff;">'
                     + "".join(row(l, d, c, i == 0) for i, (l, d, c) in enumerate(rows)) + "</section>")
    content = "\n        ".join(parts)
    rows_total = sum(len(r) for _, r in groups)
    height = max(640, 140 + rows_total * 64 + len(groups) * 44)
    dialog_h = height - 48
    return f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Настройки: {title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;display=swap" rel="stylesheet">
<style>body{{margin:0}} button{{font:inherit;color:inherit}}</style>
</helmet>
<div style="width: 1000px; height: {height}px; background: rgba(0,0,0,0.42); display: flex; align-items: center; justify-content: center; font-family: Geist, system-ui, sans-serif; color: #171717;">
  <div role="dialog" aria-label="Настройки" style="width: 952px; height: {dialog_h}px; border-radius: 14px; overflow: hidden; display: flex; background: #fff; box-shadow: 0 16px 48px rgba(0,0,0,0.18);">
    <div style="width: 232px; flex-shrink: 0; background: #fafafa; border-right: 1px solid #eaeaea;"><dc-import name="SettingsNav" active="{title}" hint-size="232px,592px"></dc-import></div>
    <main style="flex: 1; min-width: 0; padding: 24px 32px 24px 32px; overflow: hidden; background: #fafafa;">
      <h1 style="margin: 0 0 4px 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em;">{title}</h1>
        {content}
    </main>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1000,"height":{height}}}}}'>
class Component extends DCLogic {{ renderVals() {{ return {{}}; }} }}
</script>
</body>
</html>
''', height


canvas = json.load(open(root + "canvas.json", encoding="utf-8"))
if not any(p["id"] == "settings2" for p in canvas["pages"]):
    canvas["pages"].append({"id": "settings2", "name": "8. Все разделы настроек"})
x = 0
y = 300
row_h = 0
for i, (name, title, groups) in enumerate(SECTIONS):
    html, height = board(name, title, groups)
    open(root + name + ".dc.html", "w", encoding="utf-8", newline="").write(html)
    if i and i % 3 == 0:
        x = 0
        y += row_h + 120
        row_h = 0
    key = name + ".dc.html"
    canvas["boards"][key] = {"x": x, "y": y, "w": 1000, "h": height, "title": title, "page": "settings2"}
    if key not in canvas["order"]:
        canvas["order"].append(key)
    x += 1080
    row_h = max(row_h, height)
canvas["notes"]["rowSet2"] = {"x": 0, "y": 0, "text": "Все разделы настроек", "kind": "title1", "maxW": 3160, "page": "settings2"}
json.dump(canvas, open(root + "canvas.json", "w", encoding="utf-8"), ensure_ascii=False)
print("ok", [n for n, _, _ in SECTIONS])
