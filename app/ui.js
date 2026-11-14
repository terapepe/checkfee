'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { formatUnits, zeroAddress, isAddress } from 'viem';
import { checkWallet, checkTokens } from '../lib/pons';
import {
  Logo, IconWallet, IconWallets, IconCoin, IconExternal, IconCopy, IconCheck,
  IconAlert, IconRefresh, IconBolt, IconPower, TokenAvatar,
} from './icons';

export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const PONS = 'https://ponsfamily.com/launchpad';
export const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const fmt = (v, d = 18) => {
  const s = formatUnits(BigInt(v || 0), d);
  const [i, f = ''] = s.split('.');
  return f ? `${i}.${f.slice(0, 8).replace(/0+$/, '') || '0'}` : i;
};
export const toEth = wei => Number(formatUnits(BigInt(wei || 0), 18));
export const fmtUsd = v => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;

/* ---------------- Ví đang kết nối (dùng chung toàn site) ---------------- */
const WalletCtx = createContext({ account: '', connect() {}, disconnect() {} });
export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState('');
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onChange = a => setAccount(a?.[0] || '');
    eth.request({ method: 'eth_accounts' }).then(onChange).catch(() => {});
    eth.on?.('accountsChanged', onChange);
    return () => eth.removeListener?.('accountsChanged', onChange);
  }, []);
  async function connect() {
    if (!window.ethereum) return alert('Không thấy MetaMask trong trình duyệt');
    const a = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(() => []);
    setAccount(a?.[0] || '');
  }
  async function disconnect() {
    await window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => {});
    setAccount('');
  }
  return <WalletCtx.Provider value={{ account, connect, disconnect }}>{children}</WalletCtx.Provider>;
}

/* ---------------- Khung trang: sidebar trái ---------------- */
const NAV = [
  { href: '/', label: 'Check 1 ví', icon: IconWallet },
  { href: '/multi', label: 'Check nhiều ví', icon: IconWallets },
  { href: '/ca', label: 'Check theo CA', icon: IconCoin },
  { href: '/launch', label: 'Launch token', icon: IconBolt },
];

export function Shell({ children }) {
  const path = usePathname();
  const w = useWallet();
  return (
    <div className="shell">
      <aside className="side">
        <a href="/" className="brand">
          <Logo />
          <div><b>Pons Fee</b><span>Checker</span></div>
        </a>
        <nav className="menu">
          <div className="menu-label">Công cụ</div>
          {NAV.map(({ href, label, icon: Icon }) => (
            <a key={href} href={href} className={path === href ? 'on' : ''}><Icon />{label}</a>
          ))}
          <div className="menu-label">Liên kết</div>
          <a href="https://ponsfamily.com" target="_blank" rel="noreferrer"><IconExternal width={18} height={18} />Pons Family</a>
          <a href={EXPLORER} target="_blank" rel="noreferrer"><IconExternal width={18} height={18} />Blockscout</a>
        </nav>
        <div className="side-foot">
          {w.account ? (
            <button type="button" className="wallet-btn on" onClick={w.disconnect} title="Ngắt kết nối">
              <span className="dot" /><span className="mono">{short(w.account)}</span><IconPower />
            </button>
          ) : (
            <button type="button" className="wallet-btn" onClick={w.connect}><IconWallet />Connect Wallet</button>
          )}
          <div className="chain"><span className="dot live" />Robinhood Chain · 4663</div>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

export function PageHeader({ icon: Icon, title, desc }) {
  return (
    <header className="page-head">
      <div className="ph-icon"><Icon width={22} height={22} /></div>
      <div><h1>{title}</h1><p>{desc}</p></div>
    </header>
  );
}

/* ---------------- Nút & giao dịch ---------------- */
function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="icon-btn" type="button" title="Copy"
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

const CHAIN_HEX = '0x1237'; // 4663
async function ensureChain(eth) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CHAIN_HEX, chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER],
      }],
    });
  }
}

function SendButton({ wallet, to, data }) {
  const [state, setState] = useState({ busy: false, hash: '', err: '' });
  async function send() {
    const eth = window.ethereum;
    if (!eth) return setState({ busy: false, hash: '', err: 'Không thấy MetaMask trong trình duyệt' });
    setState({ busy: true, hash: '', err: '' });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      if (from.toLowerCase() !== wallet.toLowerCase()) throw new Error(`MetaMask đang chọn ví ${short(from)}, hãy chuyển sang ${short(wallet)}`);
      await ensureChain(eth);
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to, data, value: '0x0' }] });
      setState({ busy: false, hash, err: '' });
    } catch (e) {
      setState({ busy: false, hash: '', err: e.code === 4001 ? 'Đã huỷ trong MetaMask' : (e.message || String(e)) });
    }
  }
  return (
    <div className="send">
      <button type="button" className="btn-primary sm" onClick={send} disabled={state.busy}>
        <IconBolt />{state.busy ? 'Đang chờ MetaMask…' : 'Gửi bằng MetaMask'}
      </button>
      {state.hash && <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="ok">Đã gửi {short(state.hash)} <IconExternal /></a>}
      {state.err && <span className="err">{state.err}</span>}
    </div>
  );
}

function Tx({ step, title, to, data, fn, wallet }) {
  return (
    <div className="tx">
      <div className="tx-head">
        <span className="step">{step}</span>
        <div><b>{title}</b><span className="muted mono"> {fn}</span></div>
        <SendButton wallet={wallet} to={to} data={data} />
      </div>
      <div className="tx-grid">
        <span>To</span><code>{to}</code><Copy text={to} />
        <span>Amount</span><code>0</code><span />
        <span>Hex data</span><code>{data}</code><Copy text={data} />
      </div>
    </div>
  );
}

/* ---------------- Thẻ hiển thị ---------------- */
const REASON = {
  InternalSwapRequiresOperator: 'Cần swap nội bộ (buyback / quy đổi phí token) nên chỉ operator của Pons sweep được. Chờ Pons sweep rồi claim ở escrow.',
  NotCreatorFeeRecipient: 'Ví này không phải ví nhận phí hiện tại của token.',
};

export function Stats({ items }) {
  return (
    <div className="stats">
      {items.map(s => (
        <div className="stat" key={s.label}>
          <span>{s.label}</span><b className={s.accent ? 'accent' : ''}>{s.value}</b>{s.sub && <small>{s.sub}</small>}
        </div>
      ))}
    </div>
  );
}

export function TokenCard({ t, ethUsd, mode = 'wallet' }) {
  if (t.error) {
    return (
      <div className="card token err-card">
        <div className="tk-head"><IconAlert /><code>{t.token}</code></div>
        <p className="err">{t.error}</p>
      </div>
    );
  }
  const isEth = t.quote === zeroAddress;
  const usd = isEth && ethUsd ? fmtUsd(toEth(t.estimatedCreator) * ethUsd) : null;
  return (
    <div className="card token">
      <div className="tk-head">
        <TokenAvatar address={t.token} symbol={t.symbol} />
        <div className="tk-name">
          <a href={`${PONS}/${t.token}`} target="_blank" rel="noreferrer"><b>{t.name}</b> <span className="muted">${t.symbol}</span></a>
          <div className="tk-links">
            <span className="mono">{short(t.token)}</span><Copy text={t.token} />
            <a href={`${PONS}/${t.token}`} target="_blank" rel="noreferrer" className="pill">Pons <IconExternal /></a>
            <a href={`${EXPLORER}/token/${t.token}`} target="_blank" rel="noreferrer" className="pill">Blockscout <IconExternal /></a>
          </div>
        </div>
        <div className="tk-amount">
          <span className="badge">{t.phaseName}</span>
          <b>≈ {fmt(t.estimatedCreator, t.quoteDecimals)} {t.quoteSymbol}</b>
          {usd && <small>{usd}</small>}
        </div>
      </div>
      <div className="kv">
        <span>Ví nhận phí</span>
        <span className={mode === 'ca' || t.isRecipient ? '' : 'warn'}>
          <a className="mono" href={`${EXPLORER}/address/${t.creatorFeeRecipient}`} target="_blank" rel="noreferrer">{t.creatorFeeRecipient}</a>
          {mode === 'wallet' && (t.isRecipient ? <em className="tag ok">ví này</em> : <em className="tag warn">ví khác</em>)}
        </span>
        <span>Creator tax chờ sweep</span><span>{fmt(t.pendingCreatorTax, t.quoteDecimals)} {t.quoteSymbol} <i>100% của creator</i></span>
        <span>Phí gốc chờ sweep</span><span>{fmt(t.pendingBaseFee, t.quoteDecimals)} {t.quoteSymbol} <i>tổng, chia protocol {t.protocolFeeShareBps / 100}%</i></span>
        {t.phase === 2 && BigInt(t.pendingTokenSideFee) > 0n && (
          <><span>Phí phía token</span><span>{fmt(t.pendingTokenSideFee)} {t.symbol} <i>cần operator quy đổi</i></span></>
        )}
        <span>Thiết lập</span><span>Creator tax {t.creatorTaxBps / 100}% · buyback {t.buybackEnabled ? 'bật' : 'tắt'}</span>
        <span>Sweep</span>
        <span>
          {!t.sweep ? <i>Không có phí chờ sweep</i>
            : t.sweep.ok ? <span className="ok">{mode === 'ca' ? 'Ví nhận phí tự sweep được' : 'Ví này tự sweep được'} (đã giả lập)</span>
            : <span className="err">{REASON[t.sweep.reason] || `Giả lập thất bại: ${t.sweep.reason}`}</span>}
        </span>
      </div>
    </div>
  );
}

function EscrowRow({ a, ethUsd }) {
  const usd = a.asset === zeroAddress && ethUsd ? fmtUsd(toEth(a.balance) * ethUsd) : null;
  return (
    <div className="escrow-row">
      <span>{a.symbol} {a.asset !== zeroAddress && <span className="mono muted">{short(a.asset)}</span>}</span>
      <b>{fmt(a.balance, a.decimals)} {a.symbol}{usd && <small> · {usd}</small>}</b>
    </div>
  );
}

// Các bước claim cho 1 ví nhận phí
export function ClaimSteps({ wallet, tokens, escrow }) {
  const sweeps = tokens.filter(t => !t.error && t.sweep?.ok);
  const claimAssets = escrow.filter(a => BigInt(a.balance) > 0n || sweeps.some(t => t.quote === a.asset));
  if (!sweeps.length && !claimAssets.length) return <p className="empty">Hiện chưa có gì để claim.</p>;
  return (
    <div className="card claim">
      <p className="muted">Kết nối MetaMask bằng ví <span className="mono">{short(wallet)}</span> rồi bấm lần lượt từng bước, chờ bước trước thành công. Trang sẽ tự chuyển sang mạng Robinhood Chain. Có thể copy To / Hex data để gửi thủ công (MetaMask → Settings → Advanced → Show hex data).</p>
      {sweeps.map((t, i) => (
        <Tx key={t.token} step={i + 1} title={`Sweep phí ${t.symbol} vào escrow`} to={t.sweep.to} data={t.sweep.data} fn={t.sweep.fn} wallet={wallet} />
      ))}
      {claimAssets.map((a, i) => (
        <Tx key={a.asset} step={sweeps.length + i + 1} title={`Claim ${a.symbol} từ escrow về ví`} to={a.claim.to} data={a.claim.data} fn={a.claim.fn} wallet={wallet} />
      ))}
      <a className="muted small" href={`${EXPLORER}/address/${wallet}?tab=internal_txns`} target="_blank" rel="noreferrer">Kiểm tra kết quả trên Blockscout <IconExternal /></a>
    </div>
  );
}

// tổng ETH (ước tính chưa sweep + escrow) của 1 kết quả ví
export function walletEthTotals(res) {
  const pending = res.tokens.filter(t => !t.error && t.quote === zeroAddress).reduce((a, t) => a + BigInt(t.estimatedCreator), 0n);
  const escrow = BigInt(res.escrow.find(a => a.asset === zeroAddress)?.balance || 0);
  return { pending, escrow };
}

export function WalletResult({ res, compact }) {
  const { pending, escrow } = walletEthTotals(res);
  const total = toEth(pending + escrow);
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet />
        <a className="mono" href={`${EXPLORER}/address/${res.wallet}`} target="_blank" rel="noreferrer">{res.wallet}</a>
      </div>
      <Stats items={[
        { label: 'Token', value: res.tokens.length },
        { label: 'Chờ sweep (ước tính)', value: `${fmt(pending)} ETH` },
        { label: 'Trong escrow', value: `${fmt(escrow)} ETH` },
        { label: 'Tổng có thể nhận', value: res.ethUsd ? fmtUsd(total * res.ethUsd) : `${fmt(pending + escrow)} ETH`, accent: true, sub: res.ethUsd ? `ETH ≈ $${res.ethUsd.toLocaleString('en-US')}` : null },
      ]} />

      <h3>Token</h3>
      {res.tokens.length === 0 && <p className="empty">Không tìm thấy token Pons v2 nào do ví này tạo hoặc được chuyển quyền nhận phí.</p>}
      <div className={compact ? 'tokens compact' : 'tokens'}>
        {res.tokens.map(t => <TokenCard key={t.token} t={t} ethUsd={res.ethUsd} />)}
      </div>

      <h3>Số dư escrow <span className="muted">· claim được ngay</span></h3>
      <div className="card">{res.escrow.map(a => <EscrowRow key={a.asset} a={a} ethUsd={res.ethUsd} />)}</div>

      <h3>Claim bằng MetaMask</h3>
      <ClaimSteps wallet={res.wallet} tokens={res.tokens} escrow={res.escrow} />
    </section>
  );
}

export function RecipientBlock({ r, tokens, ethUsd }) {
  return (
    <section className="result">
      <div className="result-head">
        <IconWallet /><span className="muted">Ví nhận phí</span>
        <a className="mono" href={`${EXPLORER}/address/${r.wallet}`} target="_blank" rel="noreferrer">{r.wallet}</a>
        <Copy text={r.wallet} />
      </div>
      <div className="card">{r.escrow.map(a => <EscrowRow key={a.asset} a={a} ethUsd={ethUsd} />)}</div>
      <p className="muted small">Escrow gộp phí mọi token của ví này (kể cả token không có trong danh sách CA).</p>
      <ClaimSteps wallet={r.wallet} tokens={tokens} escrow={r.escrow} />
    </section>
  );
}

export function ErrorLine({ msg, onRetry, disabled }) {
  return (
    <div className="alert">
      <IconAlert /><span>{msg}</span>
      {onRetry && <button type="button" className="btn-ghost sm" onClick={onRetry} disabled={disabled}><IconRefresh />Check lại</button>}
    </div>
  );
}

export const Spinner = ({ text = 'Đang đọc dữ liệu on-chain…' }) => <div className="loading"><span className="spin" />{text}</div>;

/* ---------------- Gọi dữ liệu (chạy trong trình duyệt) ---------------- */
// Đọc on-chain bằng IP người dùng để RPC công khai không chặn IP server; thử lại khi bị rate limit.
let ethUsdCache = null;
async function getEthUsd() {
  if (ethUsdCache) return ethUsdCache;
  try {
    const j = await fetch('/api/price', { cache: 'no-store' }).then(r => r.json());
    return (ethUsdCache = j.ethUsd || null);
  } catch { return null; }
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const [data, ethUsd] = await Promise.all([fn(), getEthUsd()]);
      return { ...data, ethUsd };
    } catch (e) { last = new Error(e?.shortMessage || e?.message || String(e)); }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
}

export function fetchWallet(wallet) {
  if (!isAddress(wallet, { strict: false })) return Promise.reject(new Error('Địa chỉ ví không hợp lệ'));
  return withRetry(() => checkWallet(wallet));
}

export function fetchTokens(cas) {
  return withRetry(() => checkTokens(cas));
}

export function parseAddresses(text) {
  const list = [...new Set(text.split(/[\s,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean))];
  return { list, bad: list.filter(w => !/^0x[0-9a-f]{40}$/.test(w)) };
}
