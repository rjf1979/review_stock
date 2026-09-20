"""统计通达信分钟线（.lc1/.lc5）的覆盖范围，用于判断精确回测可用窗口。

用法：
    python tools/minute_coverage.py --freq 1 --sample 300 --out data/backtest/minute_coverage.json
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path
from typing import Any

from tdx_minute import load_minute, minute_codes


def summarize_codes(codes: list[str], freq: int, sample: int | None) -> dict[str, Any]:
    picked = codes
    if sample and sample < len(codes):
        picked = random.Random(20260920).sample(codes, sample)

    date_counter: Counter[int] = Counter()
    bar_counter: Counter[int] = Counter()
    per_code_span: list[tuple[str, int, int, int]] = []
    failed: list[str] = []

    for code in picked:
        try:
            bars = load_minute(code, freq)
        except Exception:
            failed.append(code)
            continue
        if not bars or len(bars.get("date", [])) == 0:
            failed.append(code)
            continue
        days = sorted({int(d) for d in bars["date"]})
        for d in days:
            date_counter[d] += 1
        bar_counter[len(days)] += 1
        per_code_span.append((code, days[0], days[-1], len(days)))

    days_sorted = sorted(date_counter)
    return {
        "freq": freq,
        "total_codes": len(codes),
        "sampled": len(picked),
        "ok": len(per_code_span),
        "failed": len(failed),
        "date_min": days_sorted[0] if days_sorted else None,
        "date_max": days_sorted[-1] if days_sorted else None,
        "distinct_days": len(days_sorted),
        "days_with_code_count": {str(d): date_counter[d] for d in days_sorted},
        "days_per_code_hist": {str(k): v for k, v in sorted(bar_counter.items())},
        "span_examples": per_code_span[:10],
        "failed_examples": failed[:10],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--freq", type=int, default=1, choices=(1, 5))
    ap.add_argument("--sample", type=int, default=300)
    ap.add_argument("--out", type=str, default="")
    args = ap.parse_args()

    codes = minute_codes(args.freq)
    print(f"freq={args.freq} 可用文件数={len(codes)}")
    result = summarize_codes(codes, args.freq, args.sample)
    print(json.dumps({k: v for k, v in result.items() if k != "days_with_code_count"},
                     ensure_ascii=False, indent=2))
    days = result["days_with_code_count"]
    if days:
        keys = sorted(days)
        print("首 5 个交易日:", {k: days[k] for k in keys[:5]})
        print("末 5 个交易日:", {k: days[k] for k in keys[-5:]})

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print("已写出:", out)


if __name__ == "__main__":
    main()
