# Translations 🌐

Translation catalogs are stored under `i18n/`:

```text
i18n/desktop/{locale}.json
```

To add a language:

1. Use a [BCP 47 locale code](https://gist.github.com/thewh1teagle/c8877e5c4c5e2780754ddd065ae2592e), such as `pt-BR`.
2. Copy `i18n/desktop/en-US.json` to a file named after the new locale.
3. Translate the values and keep the keys unchanged.
4. Add the locale to `i18n/locales.json` and the relevant Inlang settings file(s).
5. Run `chore check-i18n` from the repository root to check translation coverage.

Missing translations fall back to English.
