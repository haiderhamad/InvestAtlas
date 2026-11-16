import { handlePersonalBrowserMarketRequest } from '@/lib/financial-data/providers/tiingo-browser-market-data';
import { loadPersonalDailyHistory } from '@/lib/financial-data/providers/personal-history-service';
import { loadMarketDataMidpoints } from '@/lib/financial-data/providers/marketdata-personal';
import { loadYahooPersonalDailySeries } from '@/lib/financial-data/providers/yahoo-personal';

jest.mock('@/lib/runtime/deployment-mode', () => ({ INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' }));
jest.mock('@/lib/config/personal-asset-registry', () => ({
  getPersonalAssetConfig: (s:string) => ({ symbol:s, name:'Custom security', assetClass:'stock', nativeCurrency:'usd', yahooSymbol:s }),
  getPersonalListingIdentity: (s:string) => ({ version:1,symbol:s,providerSymbol:s,name:'Custom security',assetClass:'stock',nativeCurrency:'usd',exchange:'NMS',resolvedAt:'2026-11-06T00:00:00.000Z' }),
}));
jest.mock('@/lib/financial-data/providers/source-selection', () => ({
  SELF_HOSTED_MARKET:true,TIINGO_CONNECTABLE:false,
  readSourceSelection:()=>({fx:false,preferred:'marketdata',publicFirst:false}),
  marketSourceOrder:()=>['marketdata','yahoo','eodhd'],
}));
jest.mock('@/lib/financial-data/providers/twelve-personal',()=>({activeMarketOwner:()=>true,hasTwelve:()=>false,supportsTwelve:()=>false}));
jest.mock('@/lib/financial-data/providers/tiingo-browser',()=>({hasTiingoBrowserCredential:()=>false,supportsTiingoBrowserAsset:()=>false}));
jest.mock('@/lib/financial-data/providers/public-source-consent',()=>({getPublicSourceConsentRevision:()=>1,isPublicSourceApproved:()=>true}));
jest.mock('@/lib/financial-data/providers/personal-history-service',()=>({loadPersonalDailyHistory:jest.fn(),schedulePersonalHistoryWarmup:jest.fn()}));
jest.mock('@/lib/financial-data/fx/personal-history-fx',()=>({loadPersonalHistoryFx:jest.fn()}));
jest.mock('@/lib/financial-data/providers/marketdata-personal',()=>({hasMarketData:()=>true,supportsMarketDataAsset:()=>false,loadMarketDataMidpoints:jest.fn()}));
jest.mock('@/lib/financial-data/providers/yahoo-personal',()=>({supportsYahooPersonalAsset:()=>true,loadYahooPersonalDailySeries:jest.fn()}));
const history = jest.mocked(loadPersonalDailyHistory), midpoint = jest.mocked(loadMarketDataMidpoints), yahoo = jest.mocked(loadYahooPersonalDailySeries);
const originalWindow=globalThis.window;
const day=new Date(Date.now()-86_400_000).toISOString().slice(0,10);
beforeAll(()=>Object.defineProperty(globalThis,'window',{configurable:true,value:{location:new URL('https://private.example')}}));
beforeEach(()=>{history.mockReset();midpoint.mockReset();yahoo.mockReset();});
afterAll(()=>Object.defineProperty(globalThis,'window',{configurable:true,value:originalWindow}));
async function request(path:string){const response=await handlePersonalBrowserMarketRequest('/api/prices/'+path,{},'owner');return {status:response!.status,body:await response!.json()};}

test('a verified custom US security uses one fast indicative batch, with calculated quality and no fabricated change',async()=>{
  midpoint.mockResolvedValue(['ACME','OTHER'].map(assetSymbol=>({providerId:'marketdata_personal_midpoint',assetSymbol,providerSymbol:assetSymbol,listingCurrency:'USD',priceUsd:42,observedAt:new Date().toISOString(),retrievedAt:new Date().toISOString(),priceType:'indicative_model_midpoint',cacheStatus:'miss'})));
  const {body}=await request('current?symbols=ACME,OTHER&currency=usd');
  expect(Object.keys(body.prices)).toEqual(['ACME','OTHER']);
  expect(midpoint).toHaveBeenCalledTimes(1);
  expect(body.prices.ACME).toMatchObject({price:42,change24h:null,fields:{price:{quality:'calculated',provenance:{providerId:'marketdata_personal_midpoint'}}}});
  expect(body.prices.ACME.source).toMatch(/indicative/i);
  expect(yahoo).not.toHaveBeenCalled();
});

test('an explicit five-year request reads lawful durable history before compact sources, preserving its actual coverage',async()=>{
  history.mockImplementation(async(source,_owner,symbol,range)=>source==='eodhd'?{
    providerId:'eodhd_personal_daily',assetSymbol:symbol,providerSymbol:symbol+'.US',listingCurrency:'USD',retrievedAt:new Date().toISOString(),latestObservationAt:day,cacheStatus:'hit_fresh',bars:[{date:range.from,open:10,high:12,low:9,close:11,volume:5},{date:day,open:40,high:44,low:39,close:42,volume:6}],adjustment:'raw_unadjusted',requestedRange:range,availableRange:{from:range.from,to:day},coverageLimited:false,refreshFailed:false,
  }:null);
  const {status,body}=await request('history?symbol=ACME&currency=usd&interval=1d&range=5y');
  expect(status).toBe(200);expect(history.mock.calls[0][0]).toBe('eodhd');
  expect(history.mock.calls[0][3].from.slice(0,4)).toBe(String(new Date(day).getUTCFullYear()-5));
  expect(body.sources[0].providerId).toBe('eodhd_personal_daily');
  expect(body.cache.status).toBe('hit_fresh');expect(body.coverageLimited).toBe(false);
  expect(body.warnings.join(' ')).not.toContain('at most the latest 100');
});

test('old requested windows stay useful when refresh fails and are labeled stale without becoming current prices',async()=>{
  history.mockResolvedValue({providerId:'eodhd_personal_daily',assetSymbol:'ACME',providerSymbol:'ACME.US',listingCurrency:'USD',retrievedAt:'2023-06-01T00:00:00.000Z',latestObservationAt:'2023-05-31',cacheStatus:'hit_stale',bars:[{date:'2023-05-31',open:10,high:12,low:9,close:11,volume:5}],adjustment:'raw_unadjusted',requestedRange:{from:'2023-01-01',to:'2023-05-31'},availableRange:{from:'2023-05-31',to:'2023-05-31'},coverageLimited:true,refreshFailed:true});
  const {body}=await request('history?symbol=ACME&currency=usd&from=2023-01-01&to=2023-05-31');
  expect(body.prices).toHaveLength(1);expect(body.freshness).toBe('stale');expect(body.coverageLimited).toBe(true);
  expect(body.requestedRange).toEqual({from:'2023-01-01',to:'2023-05-31'});
});

test('invalid or unfinished history ranges fail before any provider request',async()=>{
  const r=await request('history?symbol=ACME&currency=usd&from=2023-02-30&to=2023-05-31');
  expect(r.status).toBe(400);expect(history).not.toHaveBeenCalled();
});
