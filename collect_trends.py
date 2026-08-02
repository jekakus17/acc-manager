#!/usr/bin/env python3
"""
Google Trends, Россия, 12 месяцев. Запросы по одному, БЕЗ режима сравнения —
сравнение нормирует всё к пику самого популярного и искажает картину.

Запуск:  pip install pytrends && python3 collect_trends.py
Выход:   trends_report.md
"""

import random
import sys
import time

QUERIES = [
    "заработок на нейросетях",
    "как заработать на нейросетях",
    "нейросети фриланс",
    "нейросеть для заработка",
]

GEO = "RU"
TIMEFRAME = "today 12-m"
MAX_RETRIES = 3
OUT = "trends_report.md"


def describe_trend(series):
    """Динамика по сравнению первой и последней трети ряда."""
    n = len(series)
    if n < 6:
        return "данных мало"
    head = series[: n // 3].mean()
    tail = series[-(n // 3):].mean()
    if head == 0:
        return "рост с нуля" if tail > 0 else "плоский"
    delta = (tail - head) / head * 100
    if delta > 15:
        return f"растёт (+{delta:.0f}% к началу периода)"
    if delta < -15:
        return f"падает ({delta:.0f}% к началу периода)"
    return f"плоский ({delta:+.0f}%)"


def spike_last_3m(series):
    """Был ли всплеск за последние 3 месяца: максимум хвоста против
    среднего+2 сигмы по предыдущей части ряда."""
    n = len(series)
    tail_len = max(1, n // 4)  # ~3 месяца из 12
    head, tail = series[:-tail_len], series[-tail_len:]
    if len(head) < 4:
        return "не оценить"
    threshold = head.mean() + 2 * head.std()
    peak = tail.max()
    if peak > threshold and peak > 0:
        return f"да, пик {peak:.0f} против порога {threshold:.0f}"
    return f"нет, пик хвоста {peak:.0f}, порог {threshold:.0f}"


def collect(pytrends, query):
    """Возвращает dict с данными или None, если Trends не отдал."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            pytrends.build_payload([query], cat=0, timeframe=TIMEFRAME, geo=GEO, gprop="")
            iot = pytrends.interest_over_time()
            if iot is None or iot.empty:
                raise ValueError("interest_over_time пустой")
            series = iot[query]
            related = pytrends.related_queries().get(query, {}) or {}
            return {
                "series": series,
                "mean": float(series.mean()),
                "last": float(series.iloc[-1]),
                "trend": describe_trend(series),
                "spike": spike_last_3m(series),
                "top": related.get("top"),
                "rising": related.get("rising"),
            }
        except Exception as e:
            print(f"  попытка {attempt}/{MAX_RETRIES} для «{query}»: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                time.sleep(random.uniform(20, 40) * attempt)
    return None


def fmt_table(df, value_col_label):
    if df is None or df.empty:
        return "_пусто_\n"
    lines = [f"| запрос | {value_col_label} |", "| --- | --- |"]
    for _, row in df.iterrows():
        val = row["value"]
        if isinstance(val, str):
            shown = val  # 'Breakout'
        elif val >= 5000:
            shown = "Breakout"
        else:
            shown = f"+{int(val)}%"
        lines.append(f"| {row['query']} | {shown} |")
    return "\n".join(lines) + "\n"


def main():
    try:
        from pytrends.request import TrendReq
    except ImportError:
        print("pytrends не установлен: pip install pytrends", file=sys.stderr)
        sys.exit(1)

    pytrends = TrendReq(hl="ru-RU", tz=180, timeout=(10, 30), retries=2, backoff_factor=1.0)

    results = {}
    for query in QUERIES:
        print(f"=== {query}", file=sys.stderr)
        results[query] = collect(pytrends, query)
        time.sleep(random.uniform(8, 15))

    ok = [q for q, r in results.items() if r]

    out = ["# Google Trends — Россия, 12 месяцев", ""]
    out.append(f"Регион `{GEO}`, timeframe `{TIMEFRAME}`, запросы по одному (без сравнения).")
    out.append("")

    if not ok:
        out.append("## Trends недоступен, собрать вручную")
        out.append("")
        out.append("После 3 попыток с паузами ни один запрос не вернул данные.")
        out.append("Числа не подставлены намеренно.")
        out.append("")
        out.append("Открыть руками на https://trends.google.com/trends/explore —")
        out.append("регион «Россия», период «Последние 12 месяцев», по одному запросу:")
        out.append("")
        for q in QUERIES:
            out.append(f"- `{q}` → interest over time + related queries (top и rising)")
    else:
        for query in QUERIES:
            r = results[query]
            out.append(f"## {query}")
            out.append("")
            if not r:
                out.append("Trends недоступен, собрать вручную.")
                out.append("")
                continue
            out.append(f"- динамика: {r['trend']}")
            out.append(f"- среднее: {r['mean']:.1f}")
            out.append(f"- последнее значение: {r['last']:.0f}")
            out.append(f"- всплеск за последние 3 месяца: {r['spike']}")
            out.append("")
            out.append("### related queries — top")
            out.append("")
            out.append(fmt_table(r["top"], "индекс"))
            out.append("### related queries — rising")
            out.append("")
            out.append(fmt_table(r["rising"], "рост"))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    print(f"Записан {OUT}; собрано запросов: {len(ok)}/{len(QUERIES)}", file=sys.stderr)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
