// 轻量数据模型：只建模页面直接展示的字段，其余字段以 raw Map 透传。

class Stock {
  const Stock({required this.code, required this.name, this.price, this.changePct});
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
  const Breadth({this.up, this.down, this.flat, this.limitUp, this.limitDown, this.amount, this.sampleCount, this.reportedCount});
  final int? up;
  final int? down;
  final int? flat;
  final int? limitUp;
  final int? limitDown;
  final double? amount;
  final int? sampleCount;
  final int? reportedCount;

  factory Breadth.fromJson(Map<String, dynamic>? j) {
    if (j == null) return const Breadth();
    return Breadth(
      up: (j['up'] as num?)?.toInt(),
      down: (j['down'] as num?)?.toInt(),
      flat: (j['flat'] as num?)?.toInt(),
      limitUp: (j['limitUp'] as num?)?.toInt(),
      limitDown: (j['limitDown'] as num?)?.toInt(),
      amount: ((j['amount'] ?? j['turnoverYi']) as num?)?.toDouble(),
      sampleCount: (j['sampleCount'] as num?)?.toInt(),
      reportedCount: (j['reportedCount'] as num?)?.toInt(),
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
        mainNet: (j['mainNet'] as num?)?.toDouble(),
      );
}

class LimitUpStock {
  const LimitUpStock({required this.name, this.code = '', this.changePct, this.streak, this.sector});
  final String code;
  final String name;
  final double? changePct;
  final int? streak;
  final String? sector;

  factory LimitUpStock.fromJson(Map<String, dynamic> j) => LimitUpStock(
        code: '${j['code'] ?? ''}',
        name: '${j['name'] ?? ''}',
        changePct: (j['changePct'] as num?)?.toDouble(),
        streak: (j['streak'] as num?)?.toInt(),
        sector: j['sector'] as String?,
      );
}

class PankouEvent {
  const PankouEvent({this.time, required this.text});
  final String? time;
  final String text;

  factory PankouEvent.fromJson(Map<String, dynamic> j) => PankouEvent(
        time: '${j['time'] ?? j['t'] ?? ''}',
        text: '${j['event'] ?? j['title'] ?? ''} ${j['name'] ?? j['code'] ?? ''}'.trim(),
      );
}

class RealtimeSnapshot {
  const RealtimeSnapshot({
    required this.indices,
    this.breadth = const Breadth(),
    this.sectors = const [],
    this.limitUpStocks = const [],
    this.pankou = const [],
    this.updatedAt,
    this.status,
    this.raw = const {},
  });
  final List<IndexQuote> indices;
  final Breadth breadth;
  final List<Sector> sectors;
  final List<LimitUpStock> limitUpStocks;
  final List<PankouEvent> pankou;
  final String? updatedAt;
  final String? status;
  final Map<String, dynamic> raw;

  factory RealtimeSnapshot.fromJson(Map<String, dynamic> j) {
    final list = (j['indices'] as List?) ?? const [];
    final sectors = (j['sectors'] as List?) ?? const [];
    final limitUp = (j['limitUpStocks'] as List?) ?? const [];
    final pankouJson = j['pankou'];
    final pankou = <dynamic>[];
    if (pankouJson is List) {
      pankou.addAll(pankouJson);
    } else if (pankouJson is Map<String, dynamic>) {
      final categories = (pankouJson['categories'] as List?) ?? const [];
      for (final category in categories.whereType<Map<String, dynamic>>()) {
        final label = '${category['label'] ?? ''}';
        final events = (category['events'] as List?) ?? const [];
        for (final event in events.whereType<Map<String, dynamic>>()) {
          pankou.add({...event, 'event': label});
        }
      }
    }
    return RealtimeSnapshot(
      indices: list.whereType<Map<String, dynamic>>().map(IndexQuote.fromJson).toList(),
      breadth: Breadth.fromJson(j['breadth'] as Map<String, dynamic>?),
      sectors: sectors.whereType<Map<String, dynamic>>().map(Sector.fromJson).toList(),
      limitUpStocks: limitUp.whereType<Map<String, dynamic>>().map(LimitUpStock.fromJson).toList(),
      pankou: pankou.whereType<Map<String, dynamic>>().map(PankouEvent.fromJson).toList(),
      updatedAt: j['updatedAt'] as String?,
      status: j['status'] as String?,
      raw: j,
    );
  }
}

class ReviewEntry {
  const ReviewEntry({required this.date, this.temperature, this.reportMode, this.qualityStatus, this.updatedAt});
  final String date;
  final num? temperature;
  final String? reportMode;
  final String? qualityStatus;
  final String? updatedAt;

  factory ReviewEntry.fromJson(Map<String, dynamic> j) => ReviewEntry(
        date: '${j['date'] ?? ''}',
        temperature: j['temperature'] as num?,
        reportMode: j['reportMode'] as String?,
        qualityStatus: j['qualityStatus'] as String?,
        updatedAt: j['updatedAt'] as String?,
      );
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
      buyers: buyers.whereType<Map<String, dynamic>>().map(DragonSeat.fromJson).toList(),
      sellers: sellers.whereType<Map<String, dynamic>>().map(DragonSeat.fromJson).toList(),
    );
  }
}
