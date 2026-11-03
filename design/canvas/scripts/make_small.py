import sys

root = sys.argv[1] + "/project/"

HEAD = '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@400;500&amp;display=swap" rel="stylesheet">
<style>body{{margin:0}} button{{font:inherit;color:inherit}}</style>
</helmet>
<div style="position: relative; width: {w}px; height: {h}px; background: #e4e4e7; font-family: Geist, system-ui, sans-serif; color: #171717; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; overflow: hidden;">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{ renderVals() {{ return {{}}; }} }}
</script>
</body>
</html>
'''


def owl(color, h):
    w = round(h * 500 / 680)
    return (f'<svg viewBox="262 200 500 680" width="{w}" height="{h}" fill="{color}" aria-hidden="true"><path fill-rule="evenodd" d="M276 214L396 296Q512 336 628 296L748 214L748 620C748 750 640 830 512 830C384 830 276 750 276 620ZM322 448A92 92 0 1 0 506 448A92 92 0 1 0 322 448ZM518 448A92 92 0 1 0 702 448A92 92 0 1 0 518 448ZM480 556L512 612L544 556Z"></path>'
            f'<path d="M362 448A52 52 0 1 1 466 448A52 52 0 1 1 362 448ZM558 448A52 52 0 1 1 662 448A52 52 0 1 1 558 448Z"></path></svg>')


DOT = '<span style="width: 9px; height: 9px; border-radius: 5px; background: #ff5b4f; flex-shrink: 0;"></span>'
PAUSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>'
STOP = '<span style="width: 10px; height: 10px; border-radius: 2px; background: #ff5b4f;"></span>'
TIME = lambda color: f'<span style="font-family: \'Geist Mono\', monospace; font-size: 14px; color: {color};">12:34</span>'

boards = {
    "PNow": ("Плашка записи сейчас", 560, 200, f'''  <section aria-label="Управление записью" style="width: 264px; height: 52px; box-sizing: border-box; border: 1px solid #e1e1e1; border-radius: 26px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px;">
    {owl("#171717", 24)}{DOT}
    <span style="flex: 1; font-size: 14px; font-weight: 500;">12:34</span>
    <button type="button" style="height: 32px; padding: 0 10px; border: 0; border-radius: 16px; background: transparent; font-size: 12px;">Пауза</button>
    <button type="button" style="height: 32px; padding: 0 12px; border: 0; border-radius: 16px; background: #b4453c; color: #fff; font-size: 12px;">Стоп</button>
  </section>'''),
    "PA": ("Плашка записи, темная", 560, 200, f'''  <section aria-label="Управление записью" style="height: 44px; box-sizing: border-box; border-radius: 22px; background: #171717; color: #ededed; box-shadow: 0 8px 24px rgba(0,0,0,0.18); display: flex; align-items: center; gap: 10px; padding: 0 6px 0 14px;">
    {owl("#ededed", 20)}{DOT}{TIME("#ededed")}
    <span style="width: 6px;"></span>
    <button type="button" aria-label="Пауза" style="width: 32px; height: 32px; border: 0; border-radius: 16px; background: transparent; color: #a1a1a1; display: grid; place-items: center;">{PAUSE}</button>
    <button type="button" aria-label="Остановить запись" style="width: 32px; height: 32px; border: 0; border-radius: 16px; background: #2a2a2a; display: grid; place-items: center;">{STOP}</button>
  </section>
  <p style="margin: 0; font-size: 12px; color: #666;">Подписи «Пауза» и «Остановить запись» появляются при наведении</p>'''),
    "PB": ("Плашка записи с уровнем звука", 560, 200, f'''  <section aria-label="Управление записью" style="height: 52px; box-sizing: border-box; border: 1px solid #e1e1e1; border-radius: 14px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.12); display: flex; align-items: center; gap: 12px; padding: 0 8px 0 14px;">
    {DOT}{TIME("#171717")}
    <span style="width: 1px; height: 24px; background: #eaeaea;"></span>
    <span style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #666;">
      <span style="display: flex; align-items: center; gap: 6px;"><span style="width: 52px;">Вы</span><span style="width: 64px; height: 4px; border-radius: 2px; background: #ebebeb; position: relative;"><span style="position: absolute; left: 0; top: 0; height: 4px; width: 60%; border-radius: 2px; background: #171717;"></span></span></span>
      <span style="display: flex; align-items: center; gap: 6px;"><span style="width: 52px;">Собеседники</span><span style="width: 64px; height: 4px; border-radius: 2px; background: #ebebeb; position: relative;"><span style="position: absolute; left: 0; top: 0; height: 4px; width: 25%; border-radius: 2px; background: #171717;"></span></span></span>
    </span>
    <button type="button" aria-label="Пауза" style="width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: #666; display: grid; place-items: center;">{PAUSE}</button>
    <button type="button" aria-label="Остановить запись" style="width: 32px; height: 32px; border: 0; border-radius: 8px; background: #f2f2f2; display: grid; place-items: center;">{STOP}</button>
  </section>
  <p style="margin: 0; font-size: 12px; color: #666;">Видно, что пишутся оба звука, а не только микрофон</p>'''),
    "PC": ("Плашка записи, минимум", 560, 200, f'''  <section aria-label="Управление записью" style="height: 36px; box-sizing: border-box; border-radius: 18px; background: #171717; display: flex; align-items: center; gap: 8px; padding: 0 5px 0 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
    {DOT}{TIME("#ededed")}
    <button type="button" aria-label="Остановить запись" style="width: 26px; height: 26px; border: 0; border-radius: 13px; background: #2a2a2a; display: grid; place-items: center;">{STOP}</button>
  </section>
  <section aria-label="Управление записью, при наведении" style="height: 36px; box-sizing: border-box; border-radius: 18px; background: #171717; display: flex; align-items: center; gap: 8px; padding: 0 5px 0 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
    {owl("#ededed", 16)}{DOT}{TIME("#ededed")}
    <button type="button" aria-label="Пауза" style="width: 26px; height: 26px; border: 0; border-radius: 13px; background: transparent; color: #a1a1a1; display: grid; place-items: center;">{PAUSE}</button>
    <button type="button" aria-label="Остановить запись" style="width: 26px; height: 26px; border: 0; border-radius: 13px; background: #2a2a2a; display: grid; place-items: center;">{STOP}</button>
  </section>
  <p style="margin: 0; font-size: 12px; color: #666;">Сверху обычный вид, снизу при наведении</p>'''),
    "MPrompt": ("Плашка звонка", 640, 200, f'''  <section aria-label="Идет созвон" style="width: 520px; height: 88px; box-sizing: border-box; border-radius: 16px; background: #171717; color: #ededed; box-shadow: 0 12px 32px rgba(0,0,0,0.22); display: flex; align-items: center; gap: 14px; padding: 0 14px 0 18px;">
    {owl("#ededed", 30)}
    <span style="flex: 1; min-width: 0;"><span style="display: block; font-size: 15px; font-weight: 500;">Созвон в Яндекс Телемост</span><span style="display: block; font-size: 13px; color: #a1a1a1; margin-top: 2px;">Микрофон и звук собеседников</span></span>
    <button type="button" style="height: 36px; padding: 0 14px; border: 0; border-radius: 9px; background: #ededed; color: #171717; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;">{DOT}Записать</button>
    <button type="button" style="height: 36px; padding: 0 12px; border: 1px solid #3a3a3a; border-radius: 9px; background: transparent; color: #ededed; font-size: 14px;">С видео</button>
    <button type="button" aria-label="Закрыть" style="width: 28px; height: 28px; border: 0; background: transparent; color: #a1a1a1; display: grid; place-items: center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>
  </section>'''),
}

VIDEO = '''<div style="position: relative; width: 480px; height: 298px; border-radius: 10px; overflow: hidden; background: #1a1a1a; box-shadow: 0 16px 40px rgba(0,0,0,0.25);">
    <div style="height: 28px; background: #2a2a2a; display: flex; align-items: center; gap: 7px; padding: 0 10px;"><span style="width: 11px; height: 11px; border-radius: 6px; background: #5a5a5a;"></span><span style="width: 11px; height: 11px; border-radius: 6px; background: #5a5a5a;"></span><span style="width: 11px; height: 11px; border-radius: 6px; background: #5a5a5a;"></span><span style="flex: 1; text-align: center; font-size: 12px; color: #a1a1a1; margin-right: 50px;">Планерка отдела продаж</span></div>
    <span style="position: absolute; left: 6%; top: 18%; width: 24%; height: 74%; border-radius: 4px; background: #262626;"></span>
    <span style="position: absolute; left: 34%; top: 18%; width: 60%; height: 50%; border-radius: 4px; background: #303030;"></span>
    <span style="position: absolute; left: 34%; top: 72%; width: 60%; height: 20%; border-radius: 4px; background: #242424;"></span>
    {overlay}
  </div>'''
OVERLAY = '''<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 44px; background: rgba(10,10,10,0.82); display: flex; align-items: center; gap: 10px; padding: 0 12px; color: #ededed;">
      <button type="button" aria-label="Пауза" style="width: 28px; height: 28px; border: 0; border-radius: 14px; background: transparent; color: #ededed; display: grid; place-items: center;">''' + PAUSE + '''</button>
      <span style="font-family: 'Geist Mono', monospace; font-size: 12.5px;">0:14 <span style="color: #a1a1a1;">/ 48:00</span></span>
      <span style="flex: 1; height: 3px; border-radius: 2px; background: #3a3a3a; position: relative;"><span style="position: absolute; left: 0; top: 0; height: 3px; width: 1%; background: #ededed;"></span></span>
      <span style="font-size: 12px; color: #a1a1a1;">звук идет из Tyto</span>
    </div>'''
boards["VNow"] = ("Окно видео сейчас", 560, 360, "  " + VIDEO.format(overlay=""))
boards["VA"] = ("Окно видео с подписями при наведении", 560, 360, "  " + VIDEO.format(overlay=OVERLAY))

for name, (title, w, h, body) in boards.items():
    open(root + name + ".dc.html", "w", encoding="utf-8", newline="").write(HEAD.format(title=title, w=w, h=h, body=body))
print("ok", len(boards))
