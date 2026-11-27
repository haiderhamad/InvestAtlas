/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GlobalAddModal from '@/components/layout/global-add-modal';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT,
  TIINGO_BROWSER_PROVIDER_CHANGE_EVENT,
} from '@/lib/financial-data/providers/tiingo-browser';
import { addManualTransaction, getAllTransactions, type AppTransaction } from '@/lib/transactions/manual-store';
import { getAllManualAccounts, type ManualAccount } from '@/lib/accounts/manual-accounts-store';
import { translateAppText } from '@/lib/i18n/app-localization';

let mockLanguage: 'en' | 'de' | 'ar' = 'en';
jest.mock('@/lib/firebase', () => ({ auth: null, db: null }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/lib/demo/workspace-mode', () => ({
  ...jest.requireActual('@/lib/demo/workspace-mode'),
  readAnonymousWorkspaceMode: () => 'local_workspace',
}));
jest.mock('@/lib/financial-data/client', () => ({ fetchFinancialData: jest.fn() }));
jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ language: mockLanguage, t: (text: string) => translateAppText(text, mockLanguage) }),
}));
jest.mock('@/lib/transactions/manual-store', () => ({
  ...jest.requireActual('@/lib/transactions/manual-store'),
  addManualTransaction: jest.fn((...args: unknown[]) => jest.requireActual('@/lib/transactions/manual-store').addManualTransaction(...args)),
}));

const accounts: ManualAccount[] = [
  { id: 'audit-broker', venue: 'audit-broker', label: 'Audit Broker', kind: 'Brokerage', createdAt: '2024-01-01T12:00:00Z' },
  { id: 'audit-cash', venue: 'audit-cash', label: 'Audit Cash', kind: 'Bank Account', portfolioScope: 'portfolio', cashCategory: 'investment_cash', cashRoutes: ['stock'], createdAt: '2024-01-01T12:00:00Z' },
];
const cash: AppTransaction = { id: 'audit-deposit', venue: 'audit-cash', type: 'deposit', asset: 'EUR', assetClass: 'cash', quote: 'EUR', amount: 100, price: 1, total: 100, fee: 0, taxType: 'cash_in', date: '2024-01-01T12:00:00Z', source: 'manual' };
const buy: AppTransaction = { id: 'audit-buy', venue: 'audit-broker', settlementVenue: 'audit-cash', type: 'buy', asset: 'META', assetClass: 'stock', quote: 'EUR', amount: 3, price: 23, total: 69, fee: 1, feeMode: 'flat', taxType: 'acquisition', date: '2024-11-20T23:30:24.001Z', source: 'manual' };

const label = (text: string) => translateAppText(text, mockLanguage);
const quantity = () => screen.getByLabelText(label('Amount / Quantity'));
const price = () => screen.getByLabelText(label('Price per Unit'));
const date = () => screen.getByLabelText(label('Date & Time'));
const submit = () => fireEvent.click(screen.getByRole('button', { name: label('Record buy') }));
const selectMeta = () => fireEvent.change(screen.getByLabelText(label('Asset / Symbol')), { target: { value: 'META' } });
const seed = (rows: AppTransaction[]) => localStorage.setItem('investatlas.manual-transactions', JSON.stringify(rows));
const trade = (amount: string, unitPrice: string, time = '2024-11-20T19:33') => {
  selectMeta();
  fireEvent.change(date(), { target: { value: time } });
  fireEvent.change(quantity(), { target: { value: amount } });
  fireEvent.change(price(), { target: { value: unitPrice } });
};

beforeEach(() => {
  mockLanguage = 'en';
  localStorage.clear();
  localStorage.setItem('investatlas.manual-accounts', JSON.stringify(accounts));
  seed([cash]);
  jest.mocked(addManualTransaction).mockClear();
  jest.mocked(fetchFinancialData).mockReset();
  jest.mocked(fetchFinancialData).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
});
afterEach(cleanup);

it('records the executed META buy with no market source', async () => {
  const close = jest.fn();
  const { container } = render(<GlobalAddModal initialVenue="audit-broker" onClose={close} />);
  const priceField = [...container.querySelectorAll('label')].find((node) => node.textContent?.trim() === 'Price per Unit')?.control;
  expect(priceField).toBeInTheDocument();
  expect(priceField).not.toHaveAttribute('readonly');
  trade('3', '23');
  submit();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(fetchFinancialData).not.toHaveBeenCalled();
  expect(getAllTransactions().find((row) => row.type === 'buy')).toMatchObject({
    asset: 'META', amount: 3, price: 23, total: 69, fee: 1, quote: 'EUR', venue: 'audit-broker', settlementVenue: 'audit-cash',
    date: new Date('2024-11-20T19:33').toISOString(),
  });
});

it.each([['en', '1.5', '2.5'], ['de', '1,5', '2,5'], ['ar', '١٫٥', '٢٫٥']] as const)('keeps partial decimal text and records fractional quantities in %s', async (language, amount, unitPrice) => {
  mockLanguage = language;
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  selectMeta();
  for (let length = 1; length <= amount.length; length++) {
    const draft = amount.slice(0, length);
    fireEvent.change(quantity(), { target: { value: draft } });
    expect(quantity()).toHaveValue(draft);
  }
  fireEvent.change(price(), { target: { value: unitPrice } });
  submit();
  await waitFor(() => expect(getAllTransactions().find((row) => row.type === 'buy')).toMatchObject({ amount: 1.5, price: 2.5, total: 3.75 }));
});

it('announces invalid decimal input and focuses the price field', () => {
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('3', '1.234,56');
  submit();
  expect(screen.getByRole('alert')).toHaveTextContent(/price/i);
  expect(price()).toHaveFocus();
  expect(price()).toHaveAttribute('aria-invalid', 'true');
  expect(getAllTransactions()).toHaveLength(1);
});

it('preserves an unchanged edit instant, including seconds and milliseconds', async () => {
  const close = jest.fn();
  seed([cash, buy]);
  render(<GlobalAddModal editTransaction={buy} onClose={close} />);
  expect(date()).toHaveValue(new Date(Date.parse(buy.date) - new Date(buy.date).getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(Date.parse(getAllTransactions().find((row) => row.id === buy.id)!.date)).toBe(Date.parse(buy.date));
});

it('makes one ledger write while pressing save twice during a pending write', async () => {
  const close = jest.fn();
  let release!: () => void;
  jest.mocked(addManualTransaction).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); }));
  render(<GlobalAddModal initialVenue="audit-broker" onClose={close} />);
  trade('3', '23');
  act(() => { submit(); submit(); });
  expect(addManualTransaction).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(close).toHaveBeenCalledTimes(1);
  expect(getAllManualAccounts()).toHaveLength(2);
});

it('requires an explicit deposit and keeps the pending buy after cancel or funding', async () => {
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('5', '23');
  submit();
  const openDeposit = () => fireEvent.click(screen.getByRole('button', { name: 'Record deposit' }));
  openDeposit();
  expect(getAllTransactions()).toEqual([expect.objectContaining({ id: cash.id })]);
  expect(screen.getByLabelText('Deposit Amount')).toHaveValue(null);
  expect(date()).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(quantity()).toHaveValue('5');
  expect(getAllTransactions()).toHaveLength(1);

  openDeposit();
  fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));
  expect(getAllTransactions()).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Deposit Amount'), { target: { value: '30' } });
  fireEvent.change(date(), { target: { value: '2024-11-19T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));
  await waitFor(() => expect(quantity()).toHaveValue('5'));
  expect(price()).toHaveValue('23');
  expect(getAllTransactions()).toHaveLength(2);
  expect(getAllTransactions()[0]).toMatchObject({ type: 'deposit', amount: 30, date: new Date('2024-11-19T10:00').toISOString() });
  submit();
  await waitFor(() => expect(getAllTransactions().some(row => row.type === 'buy')).toBe(true));
});

it('cancels a pending reference during the funding handoff and resumes without a stuck lookup', async () => {
  let finish!: (result: Response) => void;
  jest.mocked(fetchFinancialData).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('5', '23');
  fireEvent.click(screen.getByRole('button', { name: 'Find reference price' }));
  submit();
  fireEvent.click(screen.getByRole('button', { name: 'Record deposit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => finish(referenceReply('META', 24)));
  expect(screen.getByRole('button', { name: 'Find reference price' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Use reference price' })).toBeNull();
  expect(price()).toHaveValue('23');
});

it('books only the explicitly entered transfer pair before resuming the buy', async () => {
  const fundingSource = { ...accounts[1], id: 'audit-savings', venue: 'audit-savings', label: 'Audit Savings', cashCategory: 'savings_cash' };
  localStorage.setItem('investatlas.manual-accounts', JSON.stringify([...accounts, fundingSource]));
  seed([cash, { ...cash, id: 'savings-credit', venue: fundingSource.venue }]);
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('5', '23');
  submit();
  fireEvent.change(screen.getByLabelText('Select cash source'), { target: { value: fundingSource.venue } });
  fireEvent.click(screen.getByRole('button', { name: 'Record transfer' }));
  expect(getAllTransactions()).toHaveLength(2);
  expect(screen.getByLabelText('Amount')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '30' } });
  fireEvent.change(date(), { target: { value: '2024-11-19T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }));
  await waitFor(() => expect(quantity()).toHaveValue('5'));
  const transferRows = getAllTransactions().filter(row => row.type === 'transfer');
  expect(transferRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ venue: fundingSource.venue, amount: 30, quote: 'EUR', taxType: 'transfer_out' }),
    expect.objectContaining({ venue: cash.venue, amount: 30, quote: 'EUR', taxType: 'transfer_in' }),
  ]));
  expect(transferRows).toHaveLength(2);
  expect(getAllTransactions().some(row => row.type === 'buy')).toBe(false);
});

it('does not accept a sale before the position was acquired', () => {
  seed([cash, buy]);
  render(<GlobalAddModal initialVenue="audit-broker" initialType="sell" initialAsset="META" onClose={() => {}} />);
  trade('1', '23', '2024-11-18T10:00');
  fireEvent.click(screen.getByRole('button', { name: 'Record sell' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/maximum available/i);
  expect(getAllTransactions()).toHaveLength(2);
});

it('rejects a sale that would leave a later sale without stock', async () => {
  const laterSale: AppTransaction = { ...buy, id: 'later-sale', date: '2024-11-24T11:00:00.000Z', type: 'sell', taxType: 'disposal' };
  seed([cash, buy, laterSale]);
  render(<GlobalAddModal initialVenue="audit-broker" initialType="sell" initialAsset="META" onClose={() => {}} />);
  trade('1', '23', '2024-11-23T10:00');
  fireEvent.click(screen.getByRole('button', { name: 'Record sell' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/later entry/i);
  expect(getAllTransactions()).toHaveLength(3);
});

it('reports an ambiguous acquisition and sale at the same ledger instant', () => {
  const time = '2024-11-20T19:33';
  seed([cash, { ...buy, date: new Date(time).toISOString() }]);
  render(<GlobalAddModal initialVenue="audit-broker" initialType="sell" initialAsset="META" onClose={() => {}} />);
  trade('1', '23', time);
  fireEvent.click(screen.getByRole('button', { name: 'Record sell' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/time conflicts/i);
  expect(getAllTransactions()).toHaveLength(2);
});

function referenceReply(symbol: string, close: number, observedDate = '2024-11-19'): Response {
  return { ok: true, json: async () => ({
    status: 'partial', symbol, currency: 'eur',
    prices: [{ date: observedDate, close, sourceRef: 'market_1' }],
    sources: [{ ref: 'market_1', kind: 'market', providerId: 'yahoo_personal_daily', providerName: 'Fixture market' }],
  }) } as Response;
}

it('finds a sourced close on demand and changes the execution price only after explicit adoption', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(referenceReply('META', 24));
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('3', '23');
  expect(fetchFinancialData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Find reference price' }));
  await screen.findByText(/Fixture market/);
  expect(fetchFinancialData).toHaveBeenCalledWith(
    '/api/prices/history?symbol=META&currency=eur&interval=1d&from=2024-11-13&to=2024-11-19',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(price()).toHaveValue('23');
  fireEvent.click(screen.getByRole('button', { name: 'Use reference price' }));
  expect(price()).toHaveValue('24');
  expect(quantity()).toHaveValue('3');
});

it('discards an outstanding reference after the context changes and protects the draft', async () => {
  let finish!: (result: Response) => void;
  jest.mocked(fetchFinancialData).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('3', '23');
  fireEvent.click(screen.getByRole('button', { name: 'Find reference price' }));
  const signal = jest.mocked(fetchFinancialData).mock.calls[0][1]?.signal;
  fireEvent.change(date(), { target: { value: '2024-11-21T19:33' } });
  await act(async () => finish(referenceReply('META', 24)));
  expect(signal?.aborted).toBe(true);
  expect(fetchFinancialData).toHaveBeenCalledTimes(1);
  expect(price()).toHaveValue('23');
  expect(screen.queryByRole('button', { name: 'Use reference price' })).toBeNull();
});

it('updates notes on a funded buy tied with a dependent sale without changing ledger order', async () => {
  const sale: AppTransaction = { ...buy, id: 'same-time-sale', type: 'sell', taxType: 'disposal' };
  seed([buy, sale, cash]);
  const close = jest.fn();
  render(<GlobalAddModal editTransaction={buy} onClose={close} />);
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Matched to statement' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  const tied = getAllTransactions().filter(row => row.date === buy.date);
  expect(tied.map(row => row.id)).toEqual([buy.id, sale.id]);
  expect(tied[0].notes).toBe('Matched to statement');
});

it('preserves the charged fee when editing a percentage-fee trade', async () => {
  const withFee: AppTransaction = { ...buy, amount: 10, price: 100, total: 1000, fee: 20, feeMode: 'percent' };
  seed([{ ...cash, amount: 5000, total: 5000 }, withFee]);
  const close = jest.fn();
  render(<GlobalAddModal editTransaction={withFee} onClose={close} />);
  expect(screen.getByLabelText('Fee Input')).toHaveValue(2);
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Matched to statement' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(getAllTransactions().find(row => row.id === withFee.id)).toMatchObject({ feeMode: 'percent', fee: 20 });
});

it('keeps archived trade accounts out of the new-entry account list', () => {
  localStorage.setItem('investatlas.manual-accounts', JSON.stringify([...accounts, {
    ...accounts[0], id: 'archived', venue: 'archived', label: 'Archived Broker', archivedAt: '2024-08-01T00:00:00Z',
  }]));
  render(<GlobalAddModal initialType="buy" onClose={() => {}} />);
  expect(within(screen.getByLabelText('Account')).queryByRole('option', { name: /Archived Broker/ })).toBeNull();
  expect(within(screen.getByLabelText('Account')).queryByRole('option', { name: /Audit Cash/ })).toBeNull();
  expect(within(screen.getByLabelText('Account')).getByRole('option', { name: /Audit Broker/ })).toBeTruthy();
});

it('withdraws a loaded reference on a Tiingo session change', async () => {
  jest.mocked(fetchFinancialData).mockResolvedValue(referenceReply('META', 24));
  render(<GlobalAddModal initialVenue="audit-broker" onClose={() => {}} />);
  trade('3', '23');
  fireEvent.click(screen.getByRole('button', { name: 'Find reference price' }));
  await screen.findByRole('button', { name: 'Use reference price' });
  act(() => window.dispatchEvent(new Event(TIINGO_BROWSER_PROVIDER_CHANGE_EVENT)));
  expect(screen.getByRole('button', { name: 'Use reference price' })).toBeVisible();
  act(() => window.dispatchEvent(new Event(TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT)));
  expect(screen.queryByRole('button', { name: 'Use reference price' })).toBeNull();
  expect(price()).toHaveValue('23');
});
