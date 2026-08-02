#!/usr/bin/env python3
"""
Сбор автоподсказок YouTube через публичный suggest-эндпоинт.

Три прохода по каждому seed:
  1) чистый seed
  2) seed + " " + каждая буква русского алфавита (а-я)
  3) seed + " " + слова-модификаторы

Порядок подсказок в ответе НЕ сортируется — он примерно отражает
популярность. Позиция сохраняется в CSV.

Запуск:  python3 collect_suggest.py
Выход:   suggest_raw.csv (seed, prefix, position, suggestion)
"""

import csv
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "http://suggestqueries.google.com/complete/search"
OUT = "suggest_raw.csv"

SEEDS = [
    "заработок на нейросетях",
    "как заработать на нейросетях с нуля",
    "сколько платят за нейросети",
    "нейросети фриланс",
    "заработок на ии без вложений",
    "нейросети для заработка новичку",
    "первые деньги на нейросетях",
]

ALPHABET = list("абвгдеёжзийклмнопрстуфхцчшщъыьэюя")

MODIFIERS = [
    "без вложений",
    "с нуля",
    "новичку",
    "реально",
    "сколько",
    "отзывы",
    "схема",
    "2026",
]

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

MAX_RETRIES = 3


def fetch(query: str):
    """Возвращает список подсказок в исходном порядке или None при отказе."""
    params = urllib.parse.urlencode(
        {"client": "firefox", "ds": "yt", "hl": "ru", "gl": "ru", "q": query}
    )
    url = f"{ENDPOINT}?{params}"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            # формат firefox: [запрос, [подсказки...]]
            return data[1] if len(data) > 1 and isinstance(data[1], list) else []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                backoff = 5 * attempt
                print(f"  429 на «{query}», пауза {backoff}с", file=sys.stderr)
                time.sleep(backoff)
                continue
            print(f"  HTTP {e.code} на «{query}»", file=sys.stderr)
            return None
        except Exception as e:  # сеть, таймаут, битый JSON
            print(f"  ошибка на «{query}»: {e}", file=sys.stderr)
            time.sleep(2 * attempt)
    return None


def prefixes_for(seed: str):
    """Все префиксы одного seed: чистый, +буква, +модификатор."""
    yield seed
    for letter in ALPHABET:
        yield f"{seed} {letter}"
    for mod in MODIFIERS:
        yield f"{seed} {mod}"


def main():
    total = sum(1 for s in SEEDS for _ in prefixes_for(s))
    done = 0
    rows = 0
    failed = 0

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["seed", "prefix", "position", "suggestion"])

        for seed in SEEDS:
            print(f"\n=== {seed}", file=sys.stderr)
            for prefix in prefixes_for(seed):
                done += 1
                suggestions = fetch(prefix)
                if suggestions is None:
                    failed += 1
                else:
                    for position, suggestion in enumerate(suggestions, start=1):
                        writer.writerow([seed, prefix, position, suggestion])
                        rows += 1
                f.flush()
                print(
                    f"  [{done}/{total}] {prefix!r} -> "
                    f"{0 if suggestions is None else len(suggestions)}",
                    file=sys.stderr,
                )
                time.sleep(random.uniform(0.4, 0.8))

    print(
        f"\nГотово: {rows} строк в {OUT}, префиксов {done}, отказов {failed}",
        file=sys.stderr,
    )
    if rows == 0:
        print("ДАННЫХ НЕТ — эндпоинт недоступен, отчёт строить не на чем.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
