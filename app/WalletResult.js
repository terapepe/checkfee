'use client';
import { useState } from 'react';
import { formatUnits, zeroAddress } from 'viem';

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v, d = 18) => {
  const s = formatUnits(BigInt(v || 0), d);
  const [i, f = ''] = s.split('.');
  return f ? `${i}.${f.slice(0, 8).replace(/0+$/, '') || '0'}` : i;
};

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copy" type="button" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'Đã copy' : 'Copy'}
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
    <div>
      <button type="button" onClick={send} disabled={state.busy}>{state.busy ? 'Đang chờ MetaMask…' : 'Gửi bằng MetaMask'}</button>
      {state.hash && <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="ok">Đã gửi: {short(state.hash)} ↗</a>}
      {state.err && <span className="err">{state.err}</span>}
    </div>
  );
}

function Tx({ title, to, data, fn, wallet }) {
  return (
    <div className="tx">
      <strong>{title}</strong> <span className="muted">— {fn}</span>
      <SendButton wallet={wallet} to={to} data={data} />
      <div><b>To</b><code>{to}</code><Copy text={to} /></div>
      <div><b>Amount</b><code>0</code></div>
      <div><b>Hex data</b><code>{data}</code><Copy text={data} /></div>
    </div>
  );
}

const REASON = {
  InternalSwapRequiresOperator: 'Cần swap nội bộ (buyback / quy đổi phí token) nên chỉ sweep operator của Pons gọi được. Chờ Pons sweep rồi claim ở escrow.',
  NotCreatorFeeRecipient: 'Ví này không phải ví nhận phí (creatorFeeRecipient) hiện tại của token.',
};

export function WalletResult({ res }) {
  // USD only for native-ETH amounts
  const usd = (wei, asset) => (asset === zeroAddress && res?.ethUsd)
    ? (v => ` (~$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })})`)(Number(formatUnits(BigInt(wei || 0), 18)) * res.ethUsd)
    : '';
  const tokens = res?.tokens || [];
  const okTokens = tokens.filter(t => !t.error);
  const sweeps = okTokens.filter(t => t.sweep?.ok);
  const claimAssets = (res?.escrow || []).filter(a =>
    BigInt(a.balance) > 0n || sweeps.some(t => t.quote === a.asset));

  return (
    <section className="wallet">
      <h2 className="wh">Ví <span className="mono">{res.wallet}</span></h2>
          <h3>Token ({tokens.length})</h3>
          {tokens.length === 0 && <p className="muted">Không tìm thấy token Pons v2 nào do ví này tạo hoặc được chuyển quyền nhận phí.</p>}

          {tokens.map(t => t.error ? (
            <div className="card" key={t.token}><code>{t.token}</code><p className="err">Lỗi đọc dữ liệu: {t.error}</p></div>
          ) : (
            <div className="card" key={t.token}>
              <div className="row">
                <div>
                  <strong>{t.name} ({t.symbol})</strong>{' '}
                  <a href={`${EXPLORER}/token/${t.token}`} target="_blank" rel="noreferrer" className="mono">{short(t.token)}</a>
                </div>
                <div className="big">≈ {fmt(t.estimatedCreator, t.quoteDecimals)} {t.quoteSymbol}{usd(t.estimatedCreator, t.quote)}</div>
              </div>
              <div className="kv">
                <div>Giai đoạn</div><div>{t.phaseName}</div>
                <div>Ví nhận phí</div><div className={t.isRecipient ? 'ok' : 'warn'}>
                  <span className="mono">{t.creatorFeeRecipient}</span>{t.isRecipient ? ' (ví này)' : ' (ví khác!)'}
                </div>
                <div>Creator tax</div><div>{t.creatorTaxBps / 100}% · buyback {t.buybackEnabled ? 'bật' : 'tắt'} · protocol {t.protocolFeeShareBps / 100}% phí gốc</div>
                <div>Creator tax chờ sweep</div><div>{fmt(t.pendingCreatorTax, t.quoteDecimals)} {t.quoteSymbol} <span className="muted">(100% của creator)</span></div>
                <div>Phí gốc chờ sweep</div><div>{fmt(t.pendingBaseFee, t.quoteDecimals)} {t.quoteSymbol} <span className="muted">(tổng, chia protocol/creator)</span></div>
                {t.phase === 2 && BigInt(t.pendingTokenSideFee) > 0n && (
                  <><div>Phí phía token</div><div>{fmt(t.pendingTokenSideFee)} {t.symbol} <span className="muted">(cần operator quy đổi)</span></div></>
                )}
                <div>Sweep</div><div>
                  {!t.sweep ? <span className="muted">Không có phí chờ sweep</span>
                    : t.sweep.ok ? <span className="ok">Ví này tự sweep được (đã giả lập thành công)</span>
                    : <span className="err">{REASON[t.sweep.reason] || `Giả lập thất bại: ${t.sweep.reason}`}</span>}
                </div>
              </div>
            </div>
          ))}

          <h3>Số dư đã vào escrow (claim được ngay)</h3>
          {res.escrow.map(a => (
            <div className="card row" key={a.asset}>
              <div>{a.symbol} {a.asset !== zeroAddress && <span className="mono muted">{short(a.asset)}</span>}</div>
              <div className="big">{fmt(a.balance, a.decimals)} {a.symbol}{usd(a.balance, a.asset)}</div>
            </div>
          ))}
          <p className="muted">Số ≈ ở mỗi token là ước tính phần creator (creator tax + phần phí gốc sau protocol/buyback) chưa sweep. Escrow gộp phí của mọi token cùng tài sản nên một lần claim rút hết.</p>

          <h3>Claim bằng MetaMask</h3>
          {sweeps.length === 0 && claimAssets.length === 0 ? (
            <p className="muted">Hiện chưa có gì để claim.</p>
          ) : (
            <div className="card">
              <ol>
                <li>Mở MetaMask, chọn đúng ví <code>{res.wallet}</code> và mạng <b>Robinhood Chain</b> (chain ID 4663, RPC <code>https://rpc.mainnet.chain.robinhood.com</code>).</li>
                <li>Bật nhập data: <b>Settings → Advanced → Show hex data</b>.</li>
                <li>Với từng giao dịch dưới đây theo đúng thứ tự: bấm <b>Send</b>, dán <b>To</b>, Amount <b>0</b>, dán <b>Hex data</b>, Confirm và chờ thành công rồi mới làm giao dịch tiếp theo.</li>
                <li>Nếu MetaMask báo giao dịch có thể thất bại thì dừng lại, kiểm tra lại ví/mạng.</li>
              </ol>
              {sweeps.map((t, i) => (
                <Tx key={t.token} title={`${i + 1}. Sweep phí ${t.symbol} vào escrow`} to={t.sweep.to} data={t.sweep.data} fn={t.sweep.fn} wallet={res.wallet} />
              ))}
              {claimAssets.map((a, i) => (
                <Tx key={a.asset} title={`${sweeps.length + i + 1}. Claim ${a.symbol} từ escrow về ví`} to={a.claim.to} data={a.claim.data} fn={a.claim.fn} wallet={res.wallet} />
              ))}
              <p className="muted">Kiểm tra kết quả: <a href={`${EXPLORER}/address/${res.wallet}?tab=internal_txns`} target="_blank" rel="noreferrer">Internal txns của ví trên Blockscout</a>.</p>
            </div>
          )}
    </section>
  );
}

// gọi API, thử lại khi RPC công khai bị rate limit
export async function fetchWallet(wallet, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`/api/check?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (r.ok) return j;
      last = new Error(j.error || `HTTP ${r.status}`);
      if (r.status === 400) throw last;
    } catch (e) { last = e; if (/không hợp lệ/.test(e.message)) throw e; }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
}

export function Nav({ active }) {
  return (
    <nav className="nav">
      <a href="/" className={active === 'one' ? 'on' : ''}>Check 1 ví</a>
      <a href="/multi" className={active === 'multi' ? 'on' : ''}>Check nhiều ví</a>
    </nav>
  );
}
