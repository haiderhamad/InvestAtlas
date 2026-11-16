export type ShariahStatus =
  | "Compliant"
  | "Non-Compliant"
  | "Doubtful"
  | "Blocked: Source Conflict"
  | "Blocked: Insufficient Evidence"
  | "Not Screenable";

export type UserFacingShariahStatus =
  | "Shariah-Compliant"
  | "Not Shariah-Compliant"
  | "Doubtful"
  | "Requires Review"
  | "Insufficient Evidence"
  | "Unsupported";

export type ShariahMethodology =
  | "AAOIFI"
  | "MSCI Islamic"
  | "S&P Shariah / DJIM"
  | "FTSE Yasaar"
  | "FTSE IdealRatings"
  | "SC Malaysia SAC"
  | "Zoya"
  | "Musaffa"
  | "Islamicly"
  | "IFG"
  | "Practical Islamic Finance / PIF"
  | "fifth.finance"
  | "Source-Specific"
  | "Unknown";

export type ShariahReasonCategory =
  | "Business Activity"
  | "Non-Compliant Revenue"
  | "Interest-Bearing Debt"
  | "Cash and Interest-Bearing Securities"
  | "Interest Income"
  | "Accounts Receivable"
  | "ETF Holdings"
  | "Fund Structure"
  | "Securities Lending"
  | "Derivatives or Swaps"
  | "Crypto Utility"
  | "Staking or Yield"
  | "Stablecoin Reserves"
  | "Source Conflict"
  | "Missing Data"
  | "Outdated Data"
  | "Methodology Unknown";

export interface StockFinancialScreen {
  interestBearingDebtPercent?: number;
  debtDenominator?: "Total Assets" | "Market Cap" | "24M Average Market Cap" | "Unknown";
  cashAndInterestBearingItemsPercent?: number;
  cashDenominator?: "Total Assets" | "Market Cap" | "24M Average Market Cap" | "Unknown";
  interestIncomePercent?: number;
  interestIncomeDenominator?: "Total Revenue" | "Total Income" | "Unknown";
  accountsReceivablePercent?: number;
  receivablesDenominator?: "Total Assets" | "Market Cap" | "Unknown";
  fiscalPeriod?: string;
  sourceDate?: string;
  checkedAt: string;
}

export interface PurificationInfo {
  required: boolean;
  purificationRatio?: number;
  purificationAmountPerShare?: number;
  currency?: string;
  source?: string;
  fiscalPeriod?: string;
}

export type ConfidenceLevel = "High" | "Medium" | "Low";

export interface EtfShariahScreen {
  fundName: string;
  ticker: string;
  isin?: string;
  claimsShariahCompliant: boolean;
  trackedIndex?: string;
  indexMethodology?: string;
  shariahBoard?: string;
  shariahCertificateAvailable?: boolean;
  holdingsChecked: boolean;
  holdingsDate?: string;
  nonCompliantHoldingsPercent?: number;
  securitiesLending?: "Allowed" | "Not Allowed" | "Unknown";
  replicationMethod?: "Physical" | "Synthetic" | "Unknown";
  derivativesUsed?: boolean;
  derivativesExplanation?: string;
  purificationAvailable?: boolean;
  finalStatus: ShariahStatus;
  confidence: ConfidenceLevel;
}

export interface CryptoShariahScreen {
  assetName: string;
  symbol: string;
  category:
    | "Payment"
    | "Infrastructure"
    | "Smart Contract Platform"
    | "DeFi"
    | "Stablecoin"
    | "Gaming"
    | "Meme"
    | "Privacy"
    | "Exchange Token"
    | "Other";
  mainUtility?: string;
  involvesInterestBasedLending?: boolean;
  involvesGambling?: boolean;
  involvesAdultContent?: boolean;
  involvesLeverageOrDerivatives?: boolean;
  stakingAvailable?: boolean;
  stakingType?: "Network Validation" | "Lending-Based" | "Unknown";
  stablecoinReserveType?: "Cash" | "Treasuries" | "Crypto" | "Mixed" | "Unknown";
  holdersReceiveInterest?: boolean;
  sourceConflict?: boolean;
  finalStatus: ShariahStatus;
  confidence: ConfidenceLevel;
}

export interface ShariahSourceResult {
  sourceName:
    | "AAOIFI"
    | "MSCI Islamic"
    | "S&P Shariah / DJIM"
    | "FTSE Yasaar"
    | "FTSE IdealRatings"
    | "SC Malaysia SAC"
    | "Zoya"
    | "Musaffa"
    | "Islamicly"
    | "IFG"
    | "Practical Islamic Finance / PIF"
    | "fifth.finance"
    | "Annual Report"
    | "ETF Issuer"
    | "SEC EDGAR"
    | "Crypto Whitepaper"
    | "Protocol Docs"
    | "Other";
  sourceUrl?: string;
  sourceDate?: string;
  reportedStatus: "Compliant" | "Non-Compliant" | "Doubtful" | "Not Found" | "Unknown";
  methodology?: ShariahMethodology;
  reason?: string;
  confidence: ConfidenceLevel;
}

export interface ShariahScreeningResult {
  assetName: string;
  ticker?: string;
  isin?: string;
  assetClass: "Stock" | "ETF" | "Fund" | "Crypto" | "Stablecoin" | "Sukuk" | "Other";
  finalStatus: ShariahStatus;
  userFacingStatus: UserFacingShariahStatus;
  confidence: ConfidenceLevel;
  methodology: ShariahMethodology;
  reasonCategories: ShariahReasonCategory[];
  sourceBreakdown: ShariahSourceResult[];
  summaryReason: string;
  detailedReason?: string;
  stockFinancialScreen?: StockFinancialScreen;
  etfScreen?: EtfShariahScreen;
  cryptoScreen?: CryptoShariahScreen;
  purification?: PurificationInfo;
  checkedAt: string;
  sourceDate?: string;
  fiscalPeriod?: string;
  nextReviewDate?: string;
  reviewedBy: "AI" | "Manual" | "Hybrid";
  requiresManualReview: boolean;
}
