const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
async function get(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    const txt = await r.text();
    return { s: r.status, txt };
  } catch (e) {
    return { s: 0, txt: "FETCH_ERR " + e.message };
  }
}
async function main() {
  const code = "600000";
  const tencent = await get("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600000,day,,,10,qfq");
  console.log("TENCENT", tencent.s, tencent.txt.slice(0, 90));
  const sina = await get("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh600000&scale=240&ma=no&datalen=10");
  console.log("SINA", sina.s, sina.txt.slice(0, 120));
  const em = await get("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600000&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=10");
  console.log("EM", em.s, em.txt.slice(0, 120));
  const bd = await get("https://finance.pae.baidu.com/vapi/v1/getquotation?group=quotation_kline_ab&code=600000&market_type=ab&new_Format=1&ktype=day&finClientType=pc&fqType=1");
  console.log("BAIDU", bd.s, bd.txt.slice(0, 200));
  const netease = await get("http://quotes.money.163.com/service/chddata.html?code=0600000&start=20260801&end=20260903&fields=TCLOSE;HIGH;LOW;TOPEN;LCLOSE;CHG;PCHG;VOTURNOVER;VATURNOVER");
  console.log("NETEASE", netease.s, netease.txt.slice(0, 200));
  const sina2 = await get("https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/CN_MarketDataService.getKLineData?symbol=sz300750&scale=240&ma=no&datalen=10");
  console.log("SINA_SZ", sina2.s, sina2.txt.slice(0, 120));
}
main().catch((e) => console.log("ERR", e.message));
