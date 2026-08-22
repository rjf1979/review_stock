# 日报数据契约

```json
{
  "meta": {
    "requested_date": "YYYY-MM-DD",
    "trade_date": "YYYY-MM-DD",
    "as_of": "ISO-8601",
    "report_mode": "close",
    "currency": "CNY"
  },
  "temperature": {
    "score": 59,
    "zone": "修复",
    "components": {
      "breadth": 12,
      "limit_up": 13.2,
      "seal": 13.7,
      "height": 7.5,
      "promotion": 2.6,
      "mainline": 10,
      "risk_deduction": 0
    }
  },
  "sentiment": {
    "limit_up_count": 79,
    "limit_down_count": 4,
    "broken_limit_count": 23,
    "seal_rate": 0.7745,
    "max_board_height": 4,
    "promotion_success_count": 18,
    "promotion_base_count": 107,
    "promotion_rate": 0.1682
  },
  "breadth": {
    "total": 5540,
    "advance_count": 2120,
    "decline_count": 3292,
    "flat_count": 128,
    "red_rate": 0.3827,
    "turnover_yuan": 2400774685938.34,
    "previous_turnover_yuan": 2387457189783.23,
    "turnover_change_yuan": 13317496155.11,
    "turnover_change_rate": 0.005578
  },
  "indices": [
    { "name": "上证指数", "close": 0, "change_pct": 0.19 }
  ],
  "height_distribution": [
    { "board_height": 4, "count": 1, "leaders": ["示例"] }
  ],
  "industries": [
    {
      "name": "行业",
      "change_pct": 0,
      "up_count": 0,
      "down_count": 0,
      "limit_up_count": 0,
      "main_net_yuan": null,
      "leader": null
    }
  ],
  "mainlines": [
    {
      "name": "方向",
      "aliases": [],
      "score": 0,
      "axes": { "width": "strong", "height": "neutral", "fund": "strong" },
      "resonance_status": "mainline_confirmed_height_pending",
      "evidence": []
    }
  ],
  "next_focus": [],
  "quality": {
    "status": "ok",
    "confidence": "medium",
    "missing_fields": [],
    "warnings": [],
    "conflicts": [],
    "field_lineage": {}
  }
}
```

所有可选数字字段缺失时使用 `null`，不得使用 0 代替。数组缺失时使用空数组，并在 `quality.missing_fields` 记录字段路径。

