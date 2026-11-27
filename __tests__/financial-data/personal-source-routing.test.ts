import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { clearTwelve, connectTwelve, hasTwelve, invalidateTwelveDailyCache, parseTwelve, reconcileTwelve } from '@/lib/financial-data/providers/twelve-personal';
import { readSourceSelection, saveSourceSelection } from '@/lib/financial-data/providers/source-selection';
import { clearPublicSourceConsent, setPublicSourceConsent } from '@/lib/financial-data/providers/public-source-consent';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';
import { hasTiingoBrowserCredential, loadTiingoBrowserDailySeries } from '@/lib/financial-data/providers/tiingo-browser';
import { fetchPublicCryptoSpot } from '@/lib/financial-data/providers/public-crypto-spot';
import { fetchPublicCoinPaprikaSpot } from '@/lib/financial-data/providers/public-coinpaprika-spot';
import { loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';

jest.mock('@/lib/runtime/deployment-mode',()=>({INVESTATLAS_DEPLOYMENT_MODE:'private_cloud'}));
jest.mock('@/lib/financial-data/providers/source-selection',()=>({...jest.requireActual('@/lib/financial-data/providers/source-selection'),TIINGO_CONNECTABLE:true}));
jest.mock('@/lib/financial-data/providers/tiingo-browser',()=>({
  hasTiingoBrowserCredential:jest.fn(),loadTiingoBrowserDailySeries:jest.fn(),supportsTiingoBrowserAsset:(s:string)=>['AAPL','BTC'].includes(s),
}));
jest.mock('@/lib/financial-data/providers/public-crypto-spot',()=>({fetchPublicCryptoSpot:jest.fn()}));
jest.mock('@/lib/financial-data/providers/public-coinpaprika-spot',()=>({fetchPublicCoinPaprikaSpot:jest.fn()}));
jest.mock('@/lib/financial-data/providers/yahoo-personal',()=>({supportsYahooPersonalAsset:(s:string)=>['AAPL','ISWD'].includes(s),loadYahooPersonalDailySeries:jest.fn()}));
const day=new Date(Date.now()-86400000).toISOString().slice(0,10);
const payload={meta:{symbol:'AAPL',exchange:'NASDAQ',mic_code:'XNGS',currency:'USD',interval:'1day'},values:[{datetime:day,open:'10',high:'12',low:'9',close:'11',volume:'123'}]};
const series={providerId:'tiingo_browser_byok' as const,providerSymbol:'AAPL',assetSymbol:'AAPL',listingCurrency:'USD' as const,retrievedAt:new Date().toISOString(),latestObservationAt:day,cacheStatus:'miss' as const,bars:[{date:day,open:10,high:12,low:9,close:11,volume:123}]};
const previous={window:globalThis.window,fetch:global.fetch};
const session=jest.mocked(hasTiingoBrowserCredential), tiingo=jest.mocked(loadTiingoBrowserDailySeries), spot=jest.mocked(fetchPublicCryptoSpot), coinpaprika=jest.mocked(fetchPublicCoinPaprikaSpot), yahoo=jest.mocked(loadYahooPersonalDailySeries);
let owner='',index=0;
const fetchMock=jest.fn(async (_url:RequestInfo|URL,_init?:RequestInit)=>Response.json(payload));
async function load(path:string){const result=await handlePersonalBrowserMarketRequest('/api/prices/'+path,{},owner);return result!.json();}
const history='history?symbol=AAPL&currency=usd&interval=1d',btc='current?symbols=BTC&currency=usd';
beforeAll(()=>{const e=new EventTarget(),storage=new Map<string,string>();Object.assign(e,{location:new URL('https://private.example'),localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}});Object.defineProperty(globalThis,'window',{configurable:true,value:e});});
beforeEach(()=>{owner='test-owner-'+(++index);resolveBrowserWorkspace(owner);clearPublicSourceConsent();setPublicSourceConsent(owner,['spot']);clearTwelve();session.mockReset().mockReturnValue(false);tiingo.mockReset().mockResolvedValue(series);spot.mockReset().mockResolvedValue({symbol:'BTC',priceUsdPerCoin:321,observedAt:new Date().toISOString(),retrievedAt:new Date().toISOString()});coinpaprika.mockReset().mockResolvedValue({symbol:'BTC',priceUsdPerCoin:322,observedAt:new Date().toISOString(),retrievedAt:new Date().toISOString(),providerId:'coinpaprika_public'});yahoo.mockReset().mockImplementation(async (_owner,symbol)=>({providerId:'yahoo_personal_daily',exchange:symbol==='ISWD'?'GER':'NMS',assetClass:symbol==='ISWD'?'etf':'stock',providerSymbol:symbol==='ISWD'?'IUSD.DE':'AAPL',assetSymbol:symbol,listingCurrency:symbol==='ISWD'?'EUR':'USD',retrievedAt:new Date().toISOString(),latestObservationAt:day,cacheStatus:'miss',bars:[{date:day,open:60,high:62,low:59,close:symbol==='ISWD'?60.4:330,volume:1000}]}));fetchMock.mockReset().mockImplementation(async()=>Response.json(payload));global.fetch=fetchMock;});
afterAll(()=>{clearTwelve();global.fetch=previous.fetch;Object.defineProperty(globalThis,'window',{configurable:true,value:previous.window});});
test('Yahoo starts disabled and then serves the exact EUR ISWD listing and AAPL stock ahead of personal keys',async()=>{expect(await load('current?symbols=ISWD&currency=eur')).toMatchObject({status:'unavailable'});expect(yahoo).not.toHaveBeenCalled();setPublicSourceConsent(owner,['yahoo']);saveSourceSelection(owner,{...readSourceSelection(owner),yahoo:true,spot:false,coinpaprika:false,fx:false});let r=await load('current?symbols=ISWD&currency=eur');expect(r.prices.ISWD).toMatchObject({price:60.4,source:'Yahoo Finance (personal research EOD)',currency:'eur'});r=await load('history?symbol=ISWD&currency=eur&interval=1d');expect(r.sources[0].providerId).toBe('yahoo_personal_daily');r=await load('current?symbols=AAPL&currency=usd');expect(r.prices.AAPL.price).toBe(330);expect(yahoo).toHaveBeenCalledTimes(3);expect(tiingo).not.toHaveBeenCalled();});
test('public spot requires explicit approval at every login',async()=>{clearPublicSourceConsent();expect(await load(btc)).toMatchObject({status:'unavailable'});expect(spot).not.toHaveBeenCalled();});
test('CoinPaprika can be selected as the sole personal-use keyless source with honest provenance',async()=>{clearPublicSourceConsent();setPublicSourceConsent(owner,['coinpaprika']);saveSourceSelection(owner,{...readSourceSelection(owner),spot:false,coinpaprika:true});const r=await load(btc);expect(r.prices.BTC).toMatchObject({price:322,source:'CoinPaprika (personal-use public USD spot)'});expect(coinpaprika).toHaveBeenCalledWith('BTC',undefined);expect(spot).not.toHaveBeenCalled();});
test('no key: public BTC spot only, no fallback to private providers or invented stock history',async()=>{expect((await load(btc)).prices.BTC.price).toBe(321);expect(await load(history)).toMatchObject({status:'unavailable',prices:[]});expect(spot).toHaveBeenCalledTimes(1);expect(tiingo).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();});
test('disabled public spot and disabled currency conversion never trigger fallback network calls',async()=>{saveSourceSelection(owner,{...readSourceSelection(owner),spot:false,fx:false});expect(await load(btc)).toMatchObject({status:'unavailable'});session.mockReturnValue(true);expect(await load('current?symbols=AAPL&currency=eur')).toMatchObject({status:'unavailable'});expect(await load('history?symbol=AAPL&currency=eur')).toMatchObject({status:'unavailable'});expect(spot).not.toHaveBeenCalled();expect(tiingo).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();});
test('attributes missing FX only to conversion-dependent symbols in a mixed EUR batch', async () => {
  setPublicSourceConsent(owner, ['yahoo', 'spot']);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

  const result = await load('current?symbols=ISWD,AAPL,GOLD,SILVER,ADA&currency=eur');

  expect(result.prices.ISWD).toMatchObject({ price: 60.4, currency: 'eur' });
  expect(result.prices.ISWD.freshUntil).toBe(Date.parse(day + 'T23:59:59Z') + 7 * 86_400_000);
  expect(Object.keys(result.prices)).toEqual(['ISWD']);
  expect(result.issues).toEqual([
    { symbol: 'AAPL', code: 'fx_unavailable' },
    { symbol: 'GOLD', code: 'fx_unavailable' },
    { symbol: 'SILVER', code: 'fx_unavailable' },
    { symbol: 'ADA', code: 'provider_unavailable' },
  ]);
  expect(yahoo).toHaveBeenCalledWith(owner, 'ISWD', undefined);
  expect(yahoo).not.toHaveBeenCalledWith(owner, 'AAPL', expect.anything());
});
test('public vs personal preference changes real dispatch; fallback only after failure',async()=>{session.mockReturnValue(true);await load(btc);expect(spot).toHaveBeenCalledTimes(1);expect(tiingo).not.toHaveBeenCalled();saveSourceSelection(owner,{...readSourceSelection(owner),publicFirst:false});await load(btc);expect(tiingo).toHaveBeenCalledTimes(1);expect(spot).toHaveBeenCalledTimes(1);tiingo.mockRejectedValueOnce(new Error('unavailable'));expect((await load(btc)).prices.BTC.price).toBe(321);expect(spot).toHaveBeenCalledTimes(2);});
test('two independent keys: one daily provider serves history, order can be reversed, source labels follow actual provider',async()=>{session.mockReturnValue(true);await connectTwelve(owner,'synthetic-twelve-key');const [savedUrl,savedInit]=fetchMock.mock.calls[0];fetchMock.mockClear();let r=await load(history);expect(r.sources[0].providerId).toBe('tiingo_browser_byok');expect(fetchMock).not.toHaveBeenCalled();saveSourceSelection(owner,{...readSourceSelection(owner),preferred:'twelve'});r=await load(history);expect(r.sources[0]).toMatchObject({providerId:'twelve_personal_daily',providerName:'Twelve Data (personal EOD)'});expect(r.prices[0].close).toBe(11);expect(tiingo).toHaveBeenCalledTimes(1);expect(fetchMock).not.toHaveBeenCalled();expect(new URL(String(savedUrl)).origin).toBe('https://api.twelvedata.com');expect(String(savedUrl)).not.toContain('synthetic');expect(savedInit).toMatchObject({redirect:'error',credentials:'omit'});expect(new Headers(savedInit?.headers).get('authorization')).toBe('apikey synthetic-twelve-key');invalidateTwelveDailyCache();fetchMock.mockResolvedValueOnce(Response.json({status:'error'}));r=await load(history);expect(r.sources[0].providerId).toBe('tiingo_browser_byok');});
test('keys and settings do not cross owners; a failed validation never retains a key',async()=>{await connectTwelve(owner,'synthetic-twelve-key');saveSourceSelection(owner,{...readSourceSelection(owner),spot:false});expect(hasTwelve(owner)).toBe(true);const other=owner+'-other';resolveBrowserWorkspace(other);reconcileTwelve(other);expect(hasTwelve(other)).toBe(false);expect(readSourceSelection(other).spot).toBe(true);resolveBrowserWorkspace(owner);expect(hasTwelve(owner)).toBe(false);fetchMock.mockResolvedValueOnce(Response.json({status:'error'}));await expect(connectTwelve(owner,'synthetic-other-key')).rejects.toThrow();expect(hasTwelve(owner)).toBe(false);});
test.each([{currency:'EUR'},{mic_code:'XNYS'},{exchange:'LSE'},{interval:'1h'},{symbol:'MSFT'}])('rejects mismatched instrument metadata %j',wrong=>{expect(()=>parseTwelve({...payload,meta:{...payload.meta,...wrong}},'AAPL')).toThrow();});
test('rejects duplicate dates, stale prices and impossible OHLC rather than plotting them',()=>{const r=payload.values[0];for(const values of [[r,r],[{...r,datetime:'2024-02-30'}],[{...r,datetime:'2020-01-01'}],[{...r,low:'16'}]])expect(()=>parseTwelve({...payload,values},'AAPL')).toThrow();});
