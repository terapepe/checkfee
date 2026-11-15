'use client';
import { useEffect, useState } from 'react';
import { parseEther, formatEther, isAddress } from 'viem';
import { useWallet, PageHeader, ErrorLine, EXPLORER, PONS, short, fmt } from '../ui';
import { IconBolt, IconExternal, TokenAvatar, IconImage, IconTag, IconHash, IconText, IconAt, IconSend, IconGlobe, IconChat, IconArch, IconWallet, IconPercent, IconRecycle, IconCart, IconReceipt, IconLayers, IconCoin, IconSpark } from '../icons';

const L = ({ icon: Ic, children }) => <span className="lbl"><Ic />{children}</span>;
import { readLaunchInfo, buildLaunchTx, parseLaunch, waitReceipt, CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET } from '../../lib/launch';
import { launchCredits, markFeePaid, clearFeePaid } from '../../lib/credit';
import { readClankerInfo, buildClankerTx, parseClankerLaunch } from '../../lib/clanker';
import { distributorOf, createDistributorTx, routeToTx } from '../../lib/launch';

const PLATFORMS = { pons: 'Pons', clanker: 'Clanker' };
const DRAFT = 'checkfee_launch_draft';
// ticker: A-Z 0-9 only, uppercase · name: letters/digits/spaces only · contract limits per platform
const LIMIT = { pons: { name: 64, symbol: 16 }, clanker: { name: 99, symbol: 30 } };
const CLEAN = {
  symbol: v => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30),
  name: v => v.replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 99),
};
const FEES = [0, 1, 2, 3, 4, 5]; // trading fee %, Clanker minimum is 1
const DESTS = [
  ['wallet', 'Your fee wallet', 'Fees accrue to your fee wallet to claim.'],
  ['buyback', 'Buyback vest', 'Part of your creator fees buys the token back: bought tokens lock and your share releases to your fee escrow gradually over 5 years.'],
  ['holders', 'Holders', "Every creator fee is paid out to the token's holders, split by how much each holds and for how long. Two more confirmations after the launch. This is permanent: the fees can never be routed back to you."],
];

const EMPTY = { name: '', symbol: '', description: '', twitter: '', telegram: '', discord: '', website: '', farcaster: '', payout: '', fee: 1, dest: 'wallet', buy: '' };

export default function Launch() {
  const w = useWallet();
  const [f, setF] = useState(EMPTY);
  const [img, setImg] = useState({ file: null, preview: '', uri: '', uploading: false });
  const [info, setInfo] = useState(null);
  const [pf, setPf] = useState('pons');
  const isC = pf === 'clanker';
  const [st, setSt] = useState({ step: '', err: '', hash: '', token: '' });
  const set = k => e => setF(v => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : CLEAN[k] ? CLEAN[k](e.target.value) : e.target.value }));

  // draft: restore once, then save on every change until the token is launched
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d) {
        if (d.f) setF(v => ({ ...v, ...d.f }));
        if (d.pf) setPf(d.pf);
        if (d.uri) setImg({ file: null, preview: `/api/ipfs/${d.uri.replace('ipfs://', '')}`, uri: d.uri, uploading: false });
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ f, pf, uri: img.uri })); } catch {}
  }, [f, pf, img.uri, loaded]);

  const [credits, setCredits] = useState(null); // null = loading
  useEffect(() => {
    setInfo(null);
    (isC ? readClankerInfo() : readLaunchInfo(w.account)).then(setInfo).catch(() => {});
  }, [w.account, pf]);
  useEffect(() => {
    setCredits(null);
    if (w.account) launchCredits(w.account).then(setCredits).catch(() => setCredits(0));
  }, [w.account]);
  const free = credits != null && credits > 0;
  const serviceFee = free ? 0n : CHECKFEE_LAUNCH_FEE;
  useEffect(() => { if (w.account) setF(v => (v.payout ? v : { ...v, payout: w.account })); }, [w.account]);

  async function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImg({ file, preview: URL.createObjectURL(file), uri: '', uploading: true });
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setImg(v => ({ ...v, uri: j.uri, uploading: false }));
    } catch (er) {
      setImg({ file: null, preview: '', uri: '', uploading: false });
      setSt({ err: `Image upload failed: ${er.message}` });
    }
  }

  let quoteIn = 0n;
  try { quoteIn = f.buy ? parseEther(String(f.buy)) : 0n; } catch {}
  const total = info ? info.launchFee + quoteIn + serviceFee : null;
  const holders = !isC && f.dest === 'holders';
  const payoutOk = holders || isAddress(f.payout || '', { strict: false });
  const lim = LIMIT[pf];
  const lenOk = f.name.trim().length <= lim.name && f.symbol.length <= lim.symbol;
  const feeOk = !(isC && Number(f.fee) < 1);
  const ready = w.account && f.name.trim() && f.symbol.trim() && lenOk && feeOk && img.uri && payoutOk && info?.canLaunch && credits != null && !st.step;

  async function launch(e) {
    e.preventDefault();
    setSt({ step: 'Simulating transaction…' });
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      // simulate the launch first so no fee is charged for a launch that would fail
      if (isC) setSt({ step: 'Preparing Clanker launch…' });
      const tx = isC ? await buildClankerTx({ account: from, form: f, image: img.uri, quoteIn }) : await buildLaunchTx({ account: from, form: f, logo: img.uri, quoteIn });
      // unused credit (fee paid, not yet launched) → don't charge again
      const left = await launchCredits(from);
      if (left > 0) {
        setSt({ step: 'Confirm the launch in MetaMask…' });
      } else {
        setSt({ step: 'Step 1/2: CheckFee service fee 0.00003 ETH…' });
        const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: CHECKFEE_WALLET, value: '0x' + CHECKFEE_LAUNCH_FEE.toString(16) }] });
        const rc0 = await waitReceipt(h);
        if (rc0.status !== 'success') throw new Error('Service fee transfer failed');
        markFeePaid(from);
        setCredits(1);
        setSt({ step: 'Step 2/2: confirm the launch in MetaMask…' });
      }
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] });
      setSt({ step: 'Waiting for on-chain confirmation…', hash });
      const rc = await waitReceipt(hash);
      if (rc.status !== 'success') throw new Error('Launch transaction failed');
      clearFeePaid(from);
      try { localStorage.removeItem(DRAFT); } catch {}
      const L = isC ? parseClankerLaunch(rc.logs) : parseLaunch(rc.logs);
      const note = L?.token && holders ? await shareWithHolders(eth, from, L.token) : '';
      if (note) { setSt({ step: '', hash, token: '', err: note, link: `/launches/${L.token}` }); return; }
      if (L?.token) { location.href = `/launches/${L.token}`; return; } // go straight to the token page
      setSt({ step: '', hash, token: '' });
    } catch (er) {
      setSt(s => ({ ...s, step: '', err: er.code === 4001 ? 'Cancelled in MetaMask' : (er.shortMessage || er.message || String(er)) }));
    }
  }

  // Holders: deploy the token's distributor, then route creator fees to it (same steps as ponsfamily.com)
  async function shareWithHolders(eth, from, token) {
    const send = async (tx, step) => {
      setSt({ step });
      const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x0' }] });
      const rc = await waitReceipt(h);
      if (rc.status !== 'success') throw new Error(`${step} failed`);
    };
    try {
      let dist = await distributorOf(token);
      if (/^0x0+$/.test(dist)) {
        await send(createDistributorTx(token), 'Holders 1/2: create the fee distributor…');
        dist = await distributorOf(token);
      }
      await send(routeToTx(token, dist), 'Holders 2/2: route creator fees to holders…');
    } catch (er) {
      // the launch itself went through: fees still go to the launcher's wallet until routed
      return `Token launched, but fees were not handed to holders yet (${er.code === 4001 ? 'cancelled' : er.shortMessage || er.message}). Until then they go to your wallet; you can finish on ponsfamily.com from the token page.`;
    }
    return '';
  }

  if (st.token) {
    return (
      <>
        <PageHeader icon={IconBolt} title="Launch successful" desc="Your token is live on Pons v2. Creator fees go straight to your fee wallet." />
        <div className="card token">
          <div className="tk-head">
            <TokenAvatar address={st.token} symbol={f.symbol} />
            <div className="tk-name">
              <b>{f.name}</b> <span className="muted">${f.symbol}</span>
              <div className="tk-links">
                <span className="mono">{st.token}</span>
                <a className="pill" href={`${PONS}/${st.token}`} target="_blank" rel="noreferrer">Pons <IconExternal /></a>
                <a className="pill" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">Tx <IconExternal /></a>
              </div>
            </div>
          </div>
          <div className="kv">
            <span>Creator fee wallet</span><span className="mono">{f.payout}</span>
          </div>
        </div>
        <p className="hint"><a href="/launch" onClick={() => location.reload()}>← Launch another token</a></p>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={IconBolt} title="Launch token" desc={isC
        ? 'Create a token on Clanker (Uniswap v4, ETH pair). Your share of the buy/sell fee goes straight to your fee wallet.'
        : 'Create a token on Pons v2 (ETH pair). Creator fees go straight to your wallet (Pons keeps 30% of the base fee), claimable at normal cost.'} />
      <div className="seg" style={{ marginBottom: 16 }}>
        {Object.entries(PLATFORMS).map(([k, v]) => <button key={k} type="button" className={pf === k ? 'on' : ''} onClick={() => { setPf(k); if (k === 'clanker') setF(v => (Number(v.fee) < 1 ? { ...v, fee: 1 } : v)); }} disabled={!!st.step}>{v}</button>)}
      </div>
      <form className="launch" onSubmit={launch}>
        <div className="card lf">
          <h3 className="sec"><IconLayers />Token details</h3>
          <div className="lf-row">
            <label className="img-pick">
              {img.preview ? <img src={img.preview} alt="" /> : <span><IconImage /><br />+ Image<br /><small>PNG/JPG/WEBP/GIF ≤2MB</small></span>}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickImage} hidden />
              {img.uploading && <em className="badge">uploading…</em>}
              {img.uri && <em className="badge">IPFS ✓</em>}
            </label>
            <div className="lf-col">
              <label><L icon={IconTag}>Token name</L><input value={f.name} onChange={set('name')} maxLength={lim.name} placeholder="NEXT AI" required /></label>
              <label><L icon={IconHash}>Ticker</L><input value={f.symbol} onChange={set('symbol')} maxLength={lim.symbol} placeholder="NEXT" required /></label>
            </div>
          </div>
          <label><L icon={IconText}>Description</L><textarea rows={3} value={f.description} onChange={set('description')} maxLength={500} /></label>
          <div className="lf-grid">
            <label><L icon={IconAt}>X / Twitter</L><input value={f.twitter} onChange={set('twitter')} placeholder="https://x.com/…" /></label>
            <label><L icon={IconSend}>Telegram</L><input value={f.telegram} onChange={set('telegram')} placeholder="https://t.me/…" /></label>
            <label><L icon={IconGlobe}>Website</L><input value={f.website} onChange={set('website')} placeholder="https://…" /></label>
            <label><L icon={IconChat}>Discord</L><input value={f.discord} onChange={set('discord')} placeholder="https://discord.gg/…" /></label>
            <label><L icon={IconArch}>Farcaster</L><input value={f.farcaster} onChange={set('farcaster')} placeholder="https://warpcast.com/…" /></label>
          </div>
        </div>

        <div className="card lf">
          <h3 className="sec"><IconCoin width={16} height={16} />Fees &amp; first buy</h3>
          <div className="lbl-block">
            <L icon={IconPercent}>{isC ? 'Trading fee (buy & sell)' : 'Creator fee'}: <b>{f.fee}%</b></L>
            <div className="seg">
              {FEES.map(n => <button key={n} type="button" className={Number(f.fee) === n ? 'on' : ''} disabled={isC && n < 1} onClick={() => setF(v => ({ ...v, fee: n }))}>{n}%</button>)}
            </div>
            <p className="muted small">{isC ? "Charged on every buy and sell, Clanker's cut included (minimum 1%)." : 'Charged on every trade on top of the 1% Pons base fee.'}</p>
          </div>
          {!isC && (
            <fieldset className="dest">
              <legend className="muted small">Where your creator fees go</legend>
              {DESTS.map(([k, t, d]) => (
                <label key={k} className="check"><input type="radio" name="dest" checked={f.dest === k} onChange={() => setF(v => ({ ...v, dest: k }))} />
                  <span><b>{t}</b><br /><small className="muted">{d}</small></span></label>
              ))}
            </fieldset>
          )}
          {!holders && <>
            <label><L icon={IconWallet}>Creator fee wallet</L><input className="mono" value={f.payout} onChange={set('payout')} placeholder="0x…" /></label>
            <p className="muted small">{isC ? 'Receives the creator share of the trading fee (in ETH), claimable on the token page.' : 'Receives 70% of the base fee + 100% of the creator fee, claimable on the Check pages and the token page.'} Defaults to the connected wallet.</p>
          </>}
          <label><L icon={IconCart}>Buy at launch (ETH, optional)</L><input type="number" min="0" step="0.001" value={f.buy} onChange={set('buy')} placeholder="0" /></label>

          <div className="sum">
            <div><span className="lbl"><IconSpark />{isC ? 'Clanker token creation fee' : 'Ponsfamily token creation fee'}</span><b>{info ? `${formatEther(info.launchFee)} ETH` : '…'}</b></div>
            <div><span className="lbl"><IconCart />First buy</span><b>{fmt(quoteIn)} ETH</b></div>
            <div><span className="lbl"><IconReceipt />CheckFee service fee</span><b>{credits == null && w.account ? '…' : free ? <span className="ok">free{Number.isFinite(credits) ? ` (${credits} credit${credits > 1 ? 's' : ''} left)` : ''}</span> : `${formatEther(CHECKFEE_LAUNCH_FEE)} ETH`}</b></div>
            <div><span className="lbl"><IconBolt width={15} height={15} />Total{free ? '' : ' (2 transactions)'}, excl. gas</span><b className="accent">{total != null ? `${formatEther(total)} ETH` : '…'}</b></div>
          </div>
          {info && !info.canLaunch && <ErrorLine msg={isC ? 'Clanker launches are currently closed.' : 'Pons currently only allows whitelisted wallets to launch.'} />}
          {!w.account && <p className="hint">Click <b>Connect Wallet</b> in the sidebar to launch.</p>}
          <button className="btn-primary big-btn" disabled={!ready}><IconBolt />{st.step || 'Launch with MetaMask'}</button>
          {st.hash && <a className="mono small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 14)}…</a>}
          {!lenOk && <ErrorLine msg={`${PLATFORMS[pf]} allows a name up to ${lim.name} and a ticker up to ${lim.symbol} characters.`} />}
          {st.err && <ErrorLine msg={st.err} />}
          {st.link && <a className="pill" href={st.link}>Open the token page</a>}
        </div>
      </form>
    </>
  );
}
