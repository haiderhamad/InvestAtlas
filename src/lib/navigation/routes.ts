import {
  LayoutDashboard,
  ArrowLeftRight,
  PieChart,
  Receipt,
  FlaskConical,
  Brain,
  TrendingUp,
  ShieldCheck,
  Target,
  WalletCards,
  Wallet,
  CalendarDays,
  Eye,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  items: NavItem[];
};

export const dashboardLink: NavItem = { href: '/', label: 'Dashboard', icon: LayoutDashboard };
export const accountsLink: NavItem = { href: '/accounts', label: 'Accounts', icon: WalletCards };
export const budgetLink: NavItem = { href: '/budget', label: 'Budget', icon: Wallet };

export const investmentGroup: NavGroup = {
  id: 'investments',
  label: 'Investments',
  icon: TrendingUp,
  defaultOpen: true,
  items: [
    { href: '/portfolio', label: 'Portfolio', icon: PieChart },
    { href: '/transactions', label: 'Ledger', icon: ArrowLeftRight },
    { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dividends', label: 'Dividends', icon: CalendarDays },
    { href: '/watchlists', label: 'Watchlists', icon: Eye },
    { href: '/charts', label: 'Charts', icon: TrendingUp },
    { href: '/tax', label: 'Tax & Purification', icon: Receipt },
  ],
};

export const toolsGroup: NavGroup = {
  id: 'tools',
  label: 'Tools',
  icon: Brain,
  items: [
    { href: '/savings-plan', label: 'Crypto Plan', icon: Target },
    { href: '/ai-analysis', label: 'Ask AI', icon: Brain },
    { href: '/strategy-lab', label: 'Strategy', icon: FlaskConical },
    { href: '/settings/coins', label: 'Shariah Audit', icon: ShieldCheck },
  ],
};

export const allNavItems = [
  dashboardLink,
  ...investmentGroup.items,
  accountsLink,
  budgetLink,
  ...toolsGroup.items,
];
