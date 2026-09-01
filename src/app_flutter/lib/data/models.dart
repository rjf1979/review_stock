// 轻量数据模型：只建模页面直接展示的字段，其余字段以 raw Map 透传。

class Stock {
  const Stock(
      {required this.code, required this.name, this.price, this.changePct});
  final String code;
  final String name;
  final double? price;
  final double? changePct;

  factory Stock.fromJson(Map<String, dynamic> j) => Stock(
        code: '${j['code'] ?? ''}',
        name: '${j['name'] ?? ''}',
        price: ((j['price'] ?? j['latest'] ?? j['close']) as num?)?.toDouble(),
        changePct: (j['changePct'] as num?)?.toDouble(),
      );
}

class IndexQuote {
  const IndexQuote({
    required this.name,
    this.code = '',
    this.price,
    this.changePct,
    this.change,
    this.amount,
  });
  final String code;
  final String name;
  final double? price;
  final double? changePct;
  final double? change;
  final double? amount;

  factory IndexQuote.fromJson(Map<String, dynamic> j) => IndexQuote(
        code: '${j['code'] ?? ''}',
        name: '${j['name'] ?? ''}',
        price: ((j['price'] ?? j['close']) as num?)?.toDouble(),
        changePct: (j['changePct'] as num?)?.toDouble(),
        change: (j['change'] as num?)?.toDouble(),
        amount: ((j['amount'] ?? j['amountYi']) as num?)?.toDouble(),
      );
}

class Breadth {
  const Breadth(
      {this.up,
      this.down,
      this.flat,
      this.limitUp,
      this.limitDown,
      this.broken,
      this.redRatio,
      this.upDownRatio,
      this.amount,
      this.sampleCount,
      this.reportedCount,
      this.status});
  final int? up;
  final int? down;
  final int? flat;
  final int? limitUp;
  final int? limitDown;
  final int? broken;
  final double? redRatio;
  final double? upDownRatio;
  final double? amount;
  final int? sampleCount;
  final int? reportedCount;
  final String? status;

  factory Breadth.fromJson(Map<String, dynamic>? j) {
    if (j == null) return const Breadth();
    return Breadth(
      up: (j['up'] as num?)?.toInt(),
      down: (j['down'] as num?)?.toInt(),
      flat: (j['flat'] as num?)?.toInt(),
      limitUp: (j['limitUp'] as num?)?.toInt(),
      limitDown: (j['limitDown'] as num?)?.toInt(),
      broken: (j['broken'] as num?)?.toInt(),
      redRatio: (j['redRatio'] as num?)?.toDouble(),
      upDownRatio: (j['upDownRatio'] as num?)?.toDouble(),
      amount: ((j['amount'] ?? j['turnoverYi']) as num?)?.toDouble(),
      sampleCount: (j['sampleCount'] as num?)?.toInt(),
      reportedCount: (j['reportedCount'] as num?)?.toInt(),
      status: j['status'] as String?,
    );
  }
}

class Sector {
  const Sector({required this.name, this.changePct, this.mainNet});
  final String name;
  final double? changePct;
  final double? mainNet;

  factory Sector.fromJson(Map<String, dynamic> j) => Sector(
        name: '${j['name'] ?? ''}',
        changePct: (j['changePct'] as num?)?.toDouble(),
        mainNet: ((j['mainNet'] ?? j['inflowYi']) as num?)?.toDouble(),
      );
}

class LimitUpStock {
  const LimitUpStock(
      {required this.name,
      this.code = '',
      this.changePct,
      this.streak,
      this.sector,
      this.brokenCount});
  final String code;
  final String name;
  final double? changePct;
  final int? streak;
  final String? sector;
  final int? brokenCount;

  factory LimitUpStock.fromJson(Map<String, dynamic> j) => LimitUpStock(
        code: '${j['code'] ?? ''}',
        name: '${j['name'] ?? ''}',
        changePct: (j['changePct'] as num?)?.toDouble(),
        streak: (j['streak'] as num?)?.toInt(),
        sector: j['sector'] as String?,
        brokenCount: (j['brokenCount'] as num?)?.toInt(),
      );
}

class RankStock {
  const RankStock({
    required this.name,
    this.code = '',
    this.close,
    this.changePct,
    this.amountYi,
  });
  final String code;
  final String name;
  final double? close;
  final double? changePct;
  final double? amountYi;

  factory RankStock.fromJson(Map<String, dynamic> j) => RankStock(
        code: '${j['code'] ?? ''}',
        name: '${j['name'] ?? ''}',
        close: (j['close'] as num?)?.toDouble(),
        changePct: (j['changePct'] as num?)?.toDouble(),
        amountYi: (j['amountYi'] as num?)?.toDouble(),
      );
}

class MarketSession {
  const MarketSession({
    this.date,
    this.state,
    this.isTrading = false,
    this.label,
  });
  final String? date;
  final String? state;
  final bool isTrading;
  final String? label;

  factory MarketSession.fromJson(Map<String, dynamic> j) => MarketSession(
        date: j['date'] as String?,
        state: j['state'] as String?,
        isTrading: j['isTrading'] == true,
        label: j['label'] as String?,
      );
}

class RealtimeSnapshot {
  const RealtimeSnapshot({
    required this.indices,
    this.breadth = const Breadth(),
    this.sectors = const [],
    this.fallingSectors = const [],
    this.concepts = const [],
    this.fallingConcepts = const [],
    this.fundFlow = const [],
    this.outflow = const [],
    this.topGainers = const [],
    this.topLosers = const [],
    this.topTurnover = const [],
    this.limitUpStocks = const [],
    this.limitDownStocks = const [],
    this.brokenStocks = const [],
    this.limitUpCount,
    this.limitDownCount,
    this.brokenCount,
    this.marketSession,
    this.asOfDate,
    this.updatedAt,
    this.status,
    this.raw = const {},
  });
  final List<IndexQuote> indices;
  final Breadth breadth;
  final List<Sector> sectors;
  final List<Sector> fallingSectors;
  final List<Sector> concepts;
  final List<Sector> fallingConcepts;
  final List<Sector> fundFlow;
  final List<Sector> outflow;
  final List<RankStock> topGainers;
  final List<RankStock> topLosers;
  final List<RankStock> topTurnover;
  final List<LimitUpStock> limitUpStocks;
  final List<LimitUpStock> limitDownStocks;
  final List<LimitUpStock> brokenStocks;
  final int? limitUpCount;
  final int? limitDownCount;
  final int? brokenCount;
  final MarketSession? marketSession;
  final String? asOfDate;
  final String? updatedAt;
  final String? status;
  final Map<String, dynamic> raw;

  factory RealtimeSnapshot.fromJson(Map<String, dynamic> j) {
    final list = (j['indices'] as List?) ?? const [];
    final sectors = (j['sectors'] as List?) ?? const [];
    final limitUp = (j['limitUpStocks'] as List?) ?? const [];
    return RealtimeSnapshot(
      indices: list
          .whereType<Map<String, dynamic>>()
          .map(IndexQuote.fromJson)
          .toList(),
      breadth: Breadth.fromJson(j['breadth'] as Map<String, dynamic>?),
      sectors: sectors
          .whereType<Map<String, dynamic>>()
          .map(Sector.fromJson)
          .toList(),
      fallingSectors: _sectors(j['fallingSectors']),
      concepts: _sectors(j['concepts']),
      fallingConcepts: _sectors(j['fallingConcepts']),
      fundFlow: _sectors(j['fundFlow']),
      outflow: _sectors(j['outflow']),
      topGainers: _ranks(j['breadth']?['topGainers']),
      topLosers: _ranks(j['breadth']?['topLosers']),
      topTurnover: _ranks(j['breadth']?['topTurnover']),
      limitUpStocks: limitUp
          .whereType<Map<String, dynamic>>()
          .map(LimitUpStock.fromJson)
          .toList(),
      limitDownStocks: _events(j['limitDownStocks']),
      brokenStocks: _events(j['brokenStocks']),
      limitUpCount: (j['limitUpCount'] as num?)?.toInt(),
      limitDownCount: (j['limitDownCount'] as num?)?.toInt(),
      brokenCount: (j['brokenCount'] as num?)?.toInt(),
      marketSession: j['marketSession'] is Map<String, dynamic>
          ? MarketSession.fromJson(j['marketSession'])
          : null,
      asOfDate: j['asOfDate'] as String?,
      updatedAt: j['updatedAt'] as String?,
      status: j['status'] as String?,
      raw: j,
    );
  }

  static List<Sector> _sectors(dynamic value) {
    final rows = (value as List?) ?? const [];
    return rows.whereType<Map<String, dynamic>>().map(Sector.fromJson).toList();
  }

  static List<RankStock> _ranks(dynamic value) {
    final rows = (value as List?) ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(RankStock.fromJson)
        .toList();
  }

  static List<LimitUpStock> _events(dynamic value) {
    final rows = (value as List?) ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(LimitUpStock.fromJson)
        .toList();
  }
}

class ReviewEntry {
  const ReviewEntry(
      {required this.date,
      this.temperature,
      this.reportMode,
      this.qualityStatus,
      this.updatedAt});
  final String date;
  final num? temperature;
  final String? reportMode;
  final String? qualityStatus;
  final String? updatedAt;

  factory ReviewEntry.fromJson(Map<String, dynamic> j) => ReviewEntry(
        date: '${j['date'] ?? ''}',
        temperature: _temperatureScore(j['temperature']),
        reportMode: j['reportMode'] as String?,
        qualityStatus: j['qualityStatus'] as String?,
        updatedAt: j['updatedAt'] as String?,
      );

  static num? _temperatureScore(dynamic value) {
    if (value is num) return value;
    if (value is Map<String, dynamic>) return value['score'] as num?;
    return null;
  }
}

class KlinePoint {
  const KlinePoint({
    required this.date,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
  });
  final String date;
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;

  factory KlinePoint.fromJson(Map<String, dynamic> j) => KlinePoint(
        date: '${j['date'] ?? ''}',
        open: _num(j['open']) ?? 0,
        high: _num(j['high']) ?? 0,
        low: _num(j['low']) ?? 0,
        close: _num(j['close']) ?? 0,
        volume: _num(j['volume']) ?? 0,
      );

  static double? _num(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}

class DragonSeat {
  const DragonSeat({
    required this.name,
    this.type = '',
    this.buyYi,
    this.sellYi,
    this.netYi,
  });
  final String name;
  final String type;
  final double? buyYi;
  final double? sellYi;
  final double? netYi;

  factory DragonSeat.fromJson(Map<String, dynamic> j) => DragonSeat(
        name: '${j['name'] ?? ''}',
        type: '${j['type'] ?? ''}',
        buyYi: (j['buyYi'] as num?)?.toDouble(),
        sellYi: (j['sellYi'] as num?)?.toDouble(),
        netYi: (j['netYi'] as num?)?.toDouble(),
      );
}

class DragonItem {
  const DragonItem({
    required this.code,
    required this.name,
    this.changePct,
    this.buy,
    this.sell,
    this.netBuy,
    this.reason = '',
    this.buyers = const [],
    this.sellers = const [],
  });
  final String code;
  final String name;
  final double? changePct;
  final double? buy;
  final double? sell;
  final double? netBuy;
  final String reason;
  final List<DragonSeat> buyers;
  final List<DragonSeat> sellers;

  factory DragonItem.fromJson(Map<String, dynamic> j) {
    final buyers = (j['buyers'] as List?) ?? const [];
    final sellers = (j['sellers'] as List?) ?? const [];
    return DragonItem(
      code: '${j['code'] ?? ''}',
      name: '${j['name'] ?? ''}',
      changePct: (j['changePct'] as num?)?.toDouble(),
      buy: (j['buy'] as num?)?.toDouble(),
      sell: (j['sell'] as num?)?.toDouble(),
      netBuy: (j['netBuy'] as num?)?.toDouble(),
      reason: '${j['reason'] ?? ''}',
      buyers: buyers
          .whereType<Map<String, dynamic>>()
          .map(DragonSeat.fromJson)
          .toList(),
      sellers: sellers
          .whereType<Map<String, dynamic>>()
          .map(DragonSeat.fromJson)
          .toList(),
    );
  }
}
