import { parseYahooPersonalChart, fetchYahooPersonalDaily } from '@/lib/financial-data/providers/yahoo-personal-server';
import type { PersonalListingIdentity } from '@/lib/config/personal-instrument';

const now = Date.parse('2026-11-07T12:00:00Z');
const listing: PersonalListingIdentity = { version:1, symbol:'PG',providerSymbol:'PG',name:'Procter & Gamble',assetClass:'stock',nativeCurrency:'usd',exchange:'NYQ',source:'yahoo_chart',resolvedAt:new Date(now).toISOString() };
function payload(symbol = 'AAPL', from = '2024-01-01', to = '2026-11-06') {
  const timestamp:number[]=[];
  for(let t=Date.parse(from+'T16:00:00Z');t<=Date.parse(to+'T16:00:00Z');t+=86400000) if(![0,6].includes(new Date(t).getUTCDay())) timestamp.push(t/1000);
  const prices=timestamp.map((_,i)=>100+i/100);
  return {chart:{result:[{meta:{symbol,currency:'USD',instrumentType:'EQUITY',exchangeName:symbol==='PG'?'NYQ':'NMS',regularMarketTime:(now-60000)/1000,regularMarketPrice:125},timestamp,
    indicators:{quote:[{open:prices,high:prices.map(v=>v+1),low:prices.map(v=>v-1),close:prices,volume:prices.map(()=>1000)}]}}],error:null}};
}
test('explicit multi-year windows preserve all bounded closed observations rather than clipping to 100', () => {
  const data=payload();const result=parseYahooPersonalChart('AAPL',data,now,{range:{from:'2024-01-01',to:'2026-11-06'},allowHistoricalTail:true});
  expect(result.bars.length).toBeGreaterThan(700);
  expect(result.bars[0].date).toBe('2024-01-01');expect(result.bars.at(-1)?.date).toBe('2026-11-06');
  expect(result).not.toHaveProperty('current');
});
test('custom listings require exact actual symbol, currency, class and exchange', () => {
  const range={from:'2024-01-01',to:'2026-11-06'};
  const result=parseYahooPersonalChart('PG',payload('PG'),now,{listing,range,allowHistoricalTail:true});
  expect(result).toMatchObject({assetSymbol:'PG',providerSymbol:'PG',listingCurrency:'USD',exchange:'NYQ',assetClass:'stock'});
  for(const wrong of [{currency:'EUR'},{instrumentType:'ETF'},{exchangeName:'NMS'},{symbol:'MSFT'}]){
    const data=payload('PG');Object.assign(data.chart.result[0].meta,wrong);
    expect(()=>parseYahooPersonalChart('PG',data,now,{listing,range,allowHistoricalTail:true})).toThrow();
  }
});
test('a historical backfill chunk is valid even when its last bar is old, and cannot become a current quote', () => {
  const range={from:'2022-01-01',to:'2023-06-01'};
  const result=parseYahooPersonalChart('PG',payload('PG',range.from,range.to),now,{listing,range,allowHistoricalTail:true});
  expect(result.latestObservationAt).toBe('2023-06-01');expect(result).not.toHaveProperty('current');
  expect(()=>parseYahooPersonalChart('PG',payload('PG',range.from,range.to),now,{listing,range})).toThrow();
});
test('incremental ranges accept one trading session and explicit empty windows without authorizing a current quote', () => {
  const range = {from:'2026-11-06',to:'2026-11-06'};
  const one = payload('PG',range.from,range.to);
  expect(parseYahooPersonalChart('PG',one,now,{listing,range,allowHistoricalTail:true})).toMatchObject({latestObservationAt:'2026-11-06',bars:[{date:'2026-11-06'}]});
  expect(()=>parseYahooPersonalChart('PG',one,now,{listing})).toThrow();
  const weekend={from:'2026-10-31',to:'2026-11-01'};
  const empty=payload('PG',weekend.from,weekend.to);
  expect(parseYahooPersonalChart('PG',empty,now,{listing,range:weekend,allowHistoricalTail:true})).toMatchObject({latestObservationAt:null,bars:[]});
  expect(()=>parseYahooPersonalChart('PG',empty,now,{listing})).toThrow();
});
test('uses only bounded exact period dates at the fixed Yahoo origin', async () => {
  const old=global.fetch;const spy=jest.spyOn(Date,'now').mockReturnValue(now);
  try {
    global.fetch=jest.fn(async()=>Response.json(payload('PG')));
    await fetchYahooPersonalDaily('PG',undefined,{listing,range:{from:'2024-01-01',to:'2026-11-06'},allowHistoricalTail:true});
    const url=new URL(String(jest.mocked(global.fetch).mock.calls[0][0]));
    expect(url.origin).toBe('https://query1.finance.yahoo.com');expect(url.pathname).toBe('/v8/finance/chart/PG');
    expect(url.searchParams.get('period1')).toBe(String(Date.parse('2024-01-01T00:00:00Z')/1000));
    expect(url.searchParams.get('period2')).toBe(String(Date.parse('2026-11-07T00:00:00Z')/1000));
    expect(url.searchParams.has('range')).toBe(false);
  } finally {global.fetch=old;spy.mockRestore();}
});
