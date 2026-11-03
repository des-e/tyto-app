# Макеты Tyto (редизайн 0.2.1)

Копия холстов из claude.ai, чтобы макеты не потерялись. Каждый `*.dc.html` - один экран (артборд);
раскладка, страницы и заметки с выбранными вариантами - в `project/canvas.json`.

## Холсты
- `project/` - «Tyto: главное окно», https://claude.ai/artifact/RmWhcXKriE8MLEUYXtz9Q6
  Страницы: 1 Главное окно, 2 Запись до расшифровки, 3 Расшифровка, 4 Ход расшифровки,
  5 Настройки, 6 Первый запуск, 7 Маленькие окна, 8 Все разделы настроек.
  Выбранные варианты записаны зелеными заметками в canvas.json (pickS2...pickPill), решения - в
  `_vault/Decisions/2026-11-03-tyto-design-round-main-window.md`.
- `../pages/video-in-project/` - «Tyto: видео в проекте», https://claude.ai/artifact/CSYkYsRtF8T4GGhogpRBJF
- `../pages/video-and-call-pill/` - «Tyto: видео и плашка созвона», https://claude.ai/artifact/D42ViayYFq8jbucwM1PhK3
- `../pages/before-after/` - главное окно до и после правок Taste и UI/UX Pro Max
- `../pages/summary-research/` - как другие сервисы показывают саммари, темы и разбор

## Как открыть
Файлы `*.dc.html` - формат холста Design (теги `<x-dc>`, `<dc-import>`), в браузере сами по себе
не отрисуются. Чтобы снова работать с ними на холсте, их публикуют в Design-артефакт (Artifact,
type Design) вместе с `canvas.json`. HTML-страницы в `pages/before-after` и `pages/summary-research`
открываются в браузере как есть.

`scripts/make_*.py` - генераторы однотипных артбордов (разделы настроек, маленькие окна, вариант N).
