import { NextRequest, NextResponse } from 'next/server';
import { 
  findAssetByIdentifier,
  getAssetShariahStatus,
  SUPPORTED_STOCK_ASSETS, 
  SUPPORTED_ETF_ASSETS, 
  SUPPORTED_METAL_ASSETS 
} from '@/lib/config/supported-assets';
import { ShariahScreeningResult } from '@/lib/types/shariah';
import {
  getShariahDecisionReason,
  isShariahCompliant,
  type ShariahDecisionStatus,
} from '@/lib/shariah/decision';
import {
  ApiPayloadError,
  isPlainObject,
  readBoundedJson,
} from '@/lib/api/json-body';
import {
  enforceRateLimit,
  PUBLIC_COMPUTE_RATE_LIMIT,
} from '@/lib/api/rate-limit';

const MAX_CHECK_BODY_BYTES = 16 * 1024;

export interface HalalCheckResult {
  symbol: string;
  name: string;
  status: ShariahDecisionStatus;
  /** @deprecated Use status. Kept temporarily for older clients. */
  halal: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  checkedBy: 'ruleset' | 'ai';
  sourceType?: 'internal_ruleset' | 'ai_provider';
  sourceLabel: string;
  methodLabel: string;
  lastCheckedAt: string;
  requiresManualReview: boolean;
  certificateStatus?: 'not_verified' | 'not_applicable';
  certificateLabel?: string;
  externalReviewSources?: Array<{
    label: string;
    url: string;
    purpose: string;
  }>;
  criteria: string[];
  iconUrl?: string;
  sector?: string;
  shariahResult?: ShariahScreeningResult;
}

// ─── Implemented demo methodology ─────────────────────────────────────────────
// These static lists express the current core-activity screen and legacy
// catalogue only. They are not a fatwa, certificate, or dated external review.

const CORE_ACTIVITY_EXCLUSIONS: Record<string, { name: string; reason: string }> = {
  DOGE:  { name: 'Dogecoin',        reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  SHIB:  { name: 'Shiba Inu',       reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  PEPE:  { name: 'Pepe',            reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  BONK:  { name: 'Bonk',            reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  WIF:   { name: 'dogwifhat',       reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  FLOKI: { name: 'Floki',           reason: 'Memecoin with no real utility; primarily speculative (gharar).' },
  AAVE:  { name: 'Aave',            reason: 'Interest-based lending protocol; its core function involves riba.' },
  COMP:  { name: 'Compound',        reason: 'Interest-based lending protocol; its core function involves riba.' },
  MKR:   { name: 'Maker',           reason: 'Interest-based DAI mechanism with direct riba exposure.' },
  UNI:   { name: 'Uniswap',         reason: 'Liquidity-mining yields resemble interest-bearing returns (riba-adjacent).' },
  SUSHI: { name: 'SushiSwap',       reason: 'Liquidity-mining yields resemble interest-bearing returns (riba-adjacent).' },
  CRV:   { name: 'Curve Finance',   reason: 'Yield-farming and liquidity-mining mechanics are riba-adjacent.' },
  CVX:   { name: 'Convex Finance',  reason: 'Yield aggregation built around interest-like reward mechanics (riba-adjacent).' },
};

const LEGACY_POSITIVE_CATALOG: Record<string, { name: string; reason: string }> = {
  BTC:    { name: 'Bitcoin',          reason: 'Decentralized digital money with real utility and no interest-bearing mechanism.' },
  ETH:    { name: 'Ethereum',         reason: 'Smart-contract platform with broad real-world utility.' },
  SOL:    { name: 'Solana',           reason: 'High-performance blockchain platform with real utility.' },
  BNB:    { name: 'BNB',              reason: 'Exchange utility token with real utility.' },
  XRP:    { name: 'Ripple',           reason: 'Payment protocol with real utility and no direct interest mechanism.' },
  ADA:    { name: 'Cardano',          reason: 'Proof-of-stake blockchain with real utility.' },
  DOT:    { name: 'Polkadot',         reason: 'Interoperability protocol with real utility.' },
  LINK:   { name: 'Chainlink',        reason: 'Decentralized oracle network with clear real-world utility.' },
  AVAX:   { name: 'Avalanche',        reason: 'Smart-contract platform with real utility.' },
  MATIC:  { name: 'Polygon',          reason: 'Layer-2 scaling solution with real utility.' },
  ATOM:   { name: 'Cosmos',           reason: 'Interchain protocol with real utility.' },
  NEAR:   { name: 'NEAR Protocol',    reason: 'Layer-1 blockchain with real utility.' },
  SUI:    { name: 'Sui',              reason: 'Layer-1 blockchain platform with real utility.' },
  INJ:    { name: 'Injective',        reason: 'Decentralized financial infrastructure without a direct interest-bearing core mechanism.' },
  RENDER: { name: 'Render',           reason: 'Decentralized GPU rendering network with clear real-world utility.' },
  FET:    { name: 'Fetch.ai',         reason: 'AI and ML infrastructure token with real utility.' },
  TAO:    { name: 'Bittensor',        reason: 'Decentralized AI network with real utility.' },
  ARB:    { name: 'Arbitrum',         reason: 'Layer-2 scaling solution with real utility.' },
  OP:     { name: 'Optimism',         reason: 'Layer-2 scaling solution with real utility.' },
  TIA:    { name: 'Celestia',         reason: 'Modular blockchain data-availability network.' },
  SEI:    { name: 'Sei',              reason: 'Layer-1 blockchain for trading infrastructure.' },
  APT:    { name: 'Aptos',            reason: 'Layer-1 blockchain with real utility.' },
  ICP:    { name: 'Internet Computer',reason: 'Decentralized cloud computing platform.' },
  FIL:    { name: 'Filecoin',         reason: 'Decentralized file-storage network with real utility.' },
  LTC:    { name: 'Litecoin',         reason: 'Peer-to-peer payment asset with real utility.' },
  IMX:    { name: 'Immutable X',      reason: 'Layer-2 network for NFTs and gaming with real utility.' },
  ALGO:   { name: 'Algorand',         reason: 'Layer-1 blockchain with real utility.' },
  HBAR:   { name: 'Hedera',           reason: 'Enterprise DLT platform with real utility.' },
  VET:    { name: 'VeChain',          reason: 'Supply-chain blockchain with real utility.' },
  QNT:    { name: 'Quant',            reason: 'Interoperability protocol with real utility.' },
  IOTA:   { name: 'IOTA',             reason: 'IoT payment protocol with real utility.' },
};

const MANUAL_CROSS_CHECK_SOURCES: NonNullable<HalalCheckResult['externalReviewSources']> = [
  {
    label: 'Zoya',
    url: 'https://zoya.finance/',
    purpose: 'Manual cross-check for stocks, ETFs, funds, and Shariah reports where available.',
  },
  {
    label: 'Practical Islamic Finance',
    url: 'https://practicalislamichalalfinance.com/',
    purpose: 'Manual research cross-check for halal investing opinions and crypto notes.',
  },
  {
    label: 'Sharlife',
    url: 'https://sharlife.my/',
    purpose: 'Manual crypto and stock Shariah status cross-check where available.',
  },
];

const CERTIFICATE_NOT_VERIFIED = {
  certificateStatus: 'not_verified' as const,
  certificateLabel: 'No scholar certificate stored in InvestAtlas',
};

function buildInsufficientScreening(
  symbol: string,
  type: string = 'crypto',
  name?: string,
): ShariahScreeningResult {
  const checkedAt = new Date().toISOString().split('T')[0];
  return {
    assetName: name || symbol,
    ticker: symbol,
    assetClass: type === 'stock' ? 'Stock' : type === 'etf' ? 'ETF' : 'Crypto',
    finalStatus: 'Blocked: Insufficient Evidence',
    userFacingStatus: 'Insufficient Evidence',
    confidence: 'Low',
    methodology: 'Unknown',
    reasonCategories: ['Missing Data'],
    sourceBreakdown: [],
    summaryReason: 'No current, verifiable Shariah evidence is available for this asset in InvestAtlas.',
    checkedAt,
    reviewedBy: 'Manual',
    requiresManualReview: true,
  };
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, PUBLIC_COMPUTE_RATE_LIMIT);
  if (limited) return limited;

  try {
    const body = await readBoundedJson(request, MAX_CHECK_BODY_BYTES);
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    const { symbol, type = 'crypto' } = body;
    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json({ error: 'Symbol is required.' }, { status: 400 });
    }

    const sym = symbol.toUpperCase().trim();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(sym)) {
      return NextResponse.json(
        { error: 'Symbol format is invalid.' },
        { status: 400 },
      );
    }
    if (
      typeof type !== 'string' ||
      !['crypto', 'stock', 'etf', 'metal'].includes(type)
    ) {
      return NextResponse.json(
        { error: 'Asset type is invalid.' },
        { status: 400 },
      );
    }

    const curatedMatch = findAssetByIdentifier(sym);
    const canonicalSym = curatedMatch?.symbol ?? sym;
    const effectiveType = curatedMatch?.assetClass ?? type;
    const lastCheckedAt = new Date().toISOString();
    const commonCriteria = effectiveType === 'stock'
      ? [
          'Primary business activity is Shariah-compliant',
          'Debt to Market Cap < 33%',
          'Interest-bearing assets < 33%',
          'Interest-bearing debt < 33%',
        ]
      : effectiveType === 'etf'
      ? [
          'Fund follows Shariah-compliant index',
          'Issuer declaration of Shariah status',
          'Underlying holdings are screened',
        ]
      : [
          'No direct interest-bearing mechanism',
          'No excessive speculation without utility',
          'No gambling-centric use case',
          'No exposure to clearly haram industries',
        ];

    // Fast path: known haram
    if (CORE_ACTIVITY_EXCLUSIONS[canonicalSym]) {
      const known = CORE_ACTIVITY_EXCLUSIONS[canonicalSym];
      const result: HalalCheckResult = {
        symbol: canonicalSym, name: known.name,
        status: 'non_compliant',
        halal: false, confidence: 'medium',
        reason: getShariahDecisionReason('non_compliant'),
        checkedBy: 'ruleset',
        sourceType: 'internal_ruleset',
        sourceLabel: 'InvestAtlas internal ruleset',
        methodLabel: 'Implemented core-activity exclusion',
        lastCheckedAt,
        requiresManualReview: false,
        externalReviewSources: MANUAL_CROSS_CHECK_SOURCES,
        criteria: commonCriteria,
      };
      return NextResponse.json(result);
    }

    // Legacy positive allow-list entries are not sufficient evidence for a
    // current compliance decision. Keep them trackable, but require review.
    if (LEGACY_POSITIVE_CATALOG[canonicalSym]) {
      const known = LEGACY_POSITIVE_CATALOG[canonicalSym];
      const result: HalalCheckResult = {
        symbol: canonicalSym, name: known.name,
        status: 'review_required',
        halal: false, confidence: 'low',
        reason: getShariahDecisionReason('review_required'),
        checkedBy: 'ruleset',
        sourceType: 'internal_ruleset',
        sourceLabel: 'InvestAtlas internal ruleset',
        methodLabel: 'Legacy demo rule — review required',
        lastCheckedAt,
        requiresManualReview: true,
        ...CERTIFICATE_NOT_VERIFIED,
        externalReviewSources: MANUAL_CROSS_CHECK_SOURCES,
        criteria: commonCriteria,
      };
      return NextResponse.json(result);
    }

    // Fast path: check curated supported assets
    const curatedAssets = [...SUPPORTED_STOCK_ASSETS, ...SUPPORTED_ETF_ASSETS, ...SUPPORTED_METAL_ASSETS];
    const curated = curatedMatch ?? curatedAssets.find(a => a.symbol === canonicalSym);
    if (curated && curated.compliance) {
      const status = getAssetShariahStatus(curated);
      const result: HalalCheckResult = {
        symbol: curated.symbol,
        name: curated.name,
        status,
        halal: isShariahCompliant(status),
        confidence: status === 'non_compliant' ? 'high' : 'low',
        reason: getShariahDecisionReason(status),
        checkedBy: 'ruleset',
        sourceType: 'internal_ruleset',
        sourceLabel: 'InvestAtlas curated asset universe',
        methodLabel: status === 'compliant' ? 'Verified catalogue evidence' : 'Catalogue entry — review required',
        lastCheckedAt,
        requiresManualReview: status !== 'compliant' && status !== 'non_compliant',
        ...CERTIFICATE_NOT_VERIFIED,


        externalReviewSources: MANUAL_CROSS_CHECK_SOURCES,
        criteria: commonCriteria,
      };
      return NextResponse.json(result);
    }

    // Unknown or class-specific assets stay insufficient until a sourced
    // provider supplies current evidence. AI is not a source of compliance facts.
    const screeningResult = buildInsufficientScreening(sym, effectiveType, sym);
    const status: ShariahDecisionStatus = 'insufficient_data';
    const result: HalalCheckResult = {
      symbol: sym,
      name: screeningResult.assetName,
      status,
      halal: false,
      confidence: 'low',
      reason: getShariahDecisionReason(status),
      checkedBy: 'ruleset',
      sourceType: 'internal_ruleset',
      sourceLabel: 'InvestAtlas evidence gate',
      methodLabel: 'Insufficient sourced evidence',
      lastCheckedAt,
      requiresManualReview: true,
      ...CERTIFICATE_NOT_VERIFIED,
      externalReviewSources: MANUAL_CROSS_CHECK_SOURCES,
      criteria: commonCriteria,
      shariahResult: screeningResult,
    };
    return NextResponse.json(result);

  } catch (error) {
    if (error instanceof ApiPayloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Check failed.' }, { status: 500 });
  }
}
