#!/usr/bin/env python3
"""
Строит suggest_report.md из suggest_raw.csv.

Сводка:
  - топ-30 уникальных подсказок по числу разных префиксов, где они вылезли
  - отдельно те, что попадали в позиции 1-3
  - отдельно все подсказки с цифрами (суммы, годы, количества)

Запуск: python3 build_suggest_report.py
"""

import csv
import os
import re
import sys
from collections import defaultdict

SRC = "suggest_raw.csv"
OUT = "suggest_report.md"
DIGIT = re.compile(r"\d")


def main():
    if not os.path.exists(SRC):
        print(f"нет {SRC} — сначала запусти collect_suggest.py", file=sys.stderr)
        sys.exit(1)

    # подсказка -> множество префиксов, где она встретилась
    prefixes = defaultdict(set)
    seeds = defaultdict(set)
    best_pos = {}
    top3_prefixes = defaultdict(set)
    rows = 0

    with open(SRC, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows += 1
            s = row["suggestion"].strip()
            pos = int(row["position"])
            prefixes[s].add(row["prefix"])
            seeds[s].add(row["seed"])
            best_pos[s] = min(best_pos.get(s, 999), pos)
            if pos <= 3:
                top3_prefixes[s].add(row["prefix"])

    if rows == 0:
        print(f"{SRC} пустой — отчёт строить не на чем.", file=sys.stderr)
        sys.exit(1)

    def line(s, counter):
        return (
            f"| {s} | {len(counter[s])} | {len(seeds[s])} | {best_pos[s]} |"
        )

    out = ["# Автоподсказки YouTube — сводка", ""]
    out.append(
        f"Строк в `{SRC}`: {rows}. Уникальных подсказок: {len(prefixes)}. "
        f"Уникальных префиксов: {len({p for ps in prefixes.values() for p in ps})}."
    )
    out.append("")
    out.append(
        "«Префиксов» — в скольких разных вариантах ввода подсказка всплыла. "
        "Чем больше, тем устойчивее спрос. «Лучшая позиция» — минимальный "
        "порядковый номер в выдаче (порядок не сортировался)."
    )
    out.append("")

    header = ["| подсказка | префиксов | seed'ов | лучшая позиция |", "| --- | --- | --- | --- |"]

    # 1. топ-30 по числу префиксов
    out.append("## Топ-30 по частоте появления в разных префиксах")
    out.append("")
    out += header
    ranked = sorted(prefixes, key=lambda s: (-len(prefixes[s]), best_pos[s], s))
    for s in ranked[:30]:
        out.append(line(s, prefixes))
    out.append("")

    # 2. позиции 1-3
    out.append("## Подсказки в позициях 1-3")
    out.append("")
    out.append("Верх выдачи — самые частотные запросы для своего префикса.")
    out.append("")
    out += header
    ranked3 = sorted(top3_prefixes, key=lambda s: (-len(top3_prefixes[s]), best_pos[s], s))
    for s in ranked3:
        out.append(line(s, top3_prefixes))
    out.append("")

    # 3. с цифрами
    out.append("## Подсказки с цифрами (суммы, годы, количества)")
    out.append("")
    out += header
    with_digits = [s for s in prefixes if DIGIT.search(s)]
    for s in sorted(with_digits, key=lambda s: (-len(prefixes[s]), best_pos[s], s)):
        out.append(line(s, prefixes))
    if not with_digits:
        out.append("| _нет_ | | | |")
    out.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"Записан {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
