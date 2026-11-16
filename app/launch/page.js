'use client';
import { useEffect, useState } from 'react';
import { parseEther, formatEther, isAddress, getAddress } from 'viem';
import { useWallet, PageHeader, ErrorLine, EXPLORER, PONS, short, fmt, parseAddresses } from '../ui';
import { IconBolt, IconExternal, TokenAvatar, IconImage, IconTag, IconHash, IconText, IconAt, IconSend, IconGlobe, IconChat, IconArch, IconWallet, IconPercent, IconRecycle, IconCart, IconReceipt, IconLayers, IconCoin, IconSpark } from '../icons';

const L = ({ icon: Ic, children }) => <span className="lbl"><Ic />{children}</span>;
import { readLaunchInfo, buildLaunchTx, parseLaunch, waitReceipt, CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET, CHECKFEE_FEE_ON } from '../../lib/launch';
import { launchCredits, markFeePaid, clearFeePaid } from '../../lib/credit';
import { recordLaunch, approveData } from '../../lib/market';
import { TAX, readTaxInfo, buildTaxTx, parseTaxLaunch, contractMeta, pinContractMeta } from '../../lib/tax';
import { CHAINS, CHAIN_IDS, switchChain, waitOn } from '../../lib/chains';
import { ChainIcon, ChainBadge } from '../icons';
import { distributorOf, createDistributorTx, routeToTx, MAX_EXEMPT } from '../../lib/launch';

const PLATFORMS = { pons: 'Pons', clanker: 'Clanker', o1: 'o1' };
const DRAFT = 'checkfee_launch_draft';
// ticker: A-Z 0-9 only, uppercase · name: letters/digits/spaces only · contract limits per platform
const LIMIT = { pons: { name: 64, symbol: 16 }, clanker: { name: 64, symbol: 16 }, o1: { name: 64, symbol: 16 } };
const CLEAN = {
  symbol: v => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16),
  name: v => v.replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 64),
};
const FEES = [0, 1, 1.5, 2, 2.5, 3, 4, 5]; // trading fee %, Clanker / o1 minimum is 1
const DESTS = [
  ['wallet', 'Your fee wallet', 'Fees accrue to your fee wallet to claim.'],
  ['buyback', 'Buyback vest', 'Part of your creator fees buys the token back: bought tokens lock and your share releases to your fee escrow gradually over 5 years.'],
  ['holders', 'Holders', "Every creator fee is paid out to the token's holders, split by how much each holds and for how long. Two more confirmations after the launch. This is permanent: the fees can never be routed back to you."],
];

const EMPTY = { name: '', symbol: '', description: '', twitter: '', telegram: '', discord: '', website: '', farcaster: '', payout: '', fee: 1, dest: 'wallet', buy: '', autoApprove: false };

export default function Launch() {
  const w = useWallet();
  const [f, setF] = useState(EMPTY);
  const [img, setImg] = useState({ file: null, preview: '', uri: '', uploading: false });
  const [info, setInfo] = useState(null);
  const [pf, setPf] = useState('pons');
  const isC = !!TAX[pf]; // Clanker / o1: same v4 tax launch
  const PL = PLATFORMS[pf];
  const [net, setNet] = useState(4663);
  const chainId = isC ? net : 4663; // Pons is Robinhood only
  const [st, setSt] = useState({ step: '', err: '', hash: '', token: '' });
  const [scan, setScan] = useState({ busy: false, msg: '' });
  // auto-fill from the project website: only fills empty fields
  const autofill = async () => {
    if (!f.website.trim()) return;
    setScan({ busy: true, msg: '' });
    try {
      const d = await fetch(`/api/scan-site?url=${encodeURIComponent(f.website.trim())}`).then(r => r.json());
      if (d.error) throw new Error(d.error);
      const got = { name: d.name ? CLEAN.name(d.name).trim() : '', symbol: d.symbol ? CLEAN.symbol(d.symbol) : '', description: (d.description || '').slice(0, 500), twitter: d.x || '', telegram: d.telegram || '' };
      const filled = Object.keys(got).filter(k => got[k] && !f[k]);
      setF(v => { const n = { ...v }; for (const k of filled) if (!n[k]) n[k] = got[k]; return n; });
      setScan({ busy: false, msg: filled.length ? `Filled: ${filled.join(', ')}. Please review.` : 'Nothing new found.' });
    } catch (e) {
      setScan({ busy: false, msg: e.message || 'Scan failed' });
    }
  };
  const set = k => e =>setF(v => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : CLEAN[k] ? CLEAN[k](e.target.value) : e.target.value }));

  // draft: restore once, then save on every change until the token is launched
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d) {
        if (d.f) setF(v => ({ ...v, ...d.f, payout: '' }));
        if (d.pf) setPf(d.pf);
        if (CHAINS[d.net]) setNet(d.net);
        if (d.uri) setImg({ file: null, preview: `/api/ipfs/${d.uri.replace('ipfs://', '')}`, uri: d.uri, uploading: false });
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ f: { ...f, payout: '' }, pf, net, uri: img.uri })); } catch {}
  }, [f, pf, net, img.uri, loaded]);

  const [credits, setCredits] = useState(null); // null = loading
  useEffect(() => {
    setInfo(null);
    (isC ? readTaxInfo(pf, chainId) : readLaunchInfo(w.account)).then(setInfo).catch(() => {});
  }, [w.account, pf, chainId]);
  useEffect(() => {
    if (!CHECKFEE_FEE_ON) return setCredits(Infinity); // service fee off: every launch is free
    setCredits(null);
    if (w.account) launchCredits(w.account, chainId).then(setCredits).catch(() => setCredits(0));
  }, [w.account, chainId]);
  const free = credits != null && credits > 0;
  const serviceFee = free ? 0n : CHECKFEE_LAUNCH_FEE;

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
  // Pons whitelist: wallets exempt from the snipe tax at launch (not saved in the draft)
  const [wl, setWl] = useState('');
  const wlParsed = parseAddresses(wl);
  const wlOk = isC || (!wlParsed.bad.length && wlParsed.list.length <= MAX_EXEMPT);
  // empty fee wallet = the connected wallet
  const payoutOk = holders || !f.payout.trim() || isAddress(f.payout.trim(), { strict: false });
  const lim = LIMIT[pf];
  const lenOk = f.name.trim().length <= lim.name && f.symbol.length <= lim.symbol;
  const feeOk = !(isC && Number(f.fee) < 1);
  const ready = w.account && f.name.trim() && f.symbol.trim() && lenOk && feeOk && img.uri && payoutOk && wlOk && info?.canLaunch && credits != null && !st.step;

  async function launch(e) {
    e.preventDefault();
    setSt({ step: 'Simulating transaction…' });
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, chainId);
      const form = { ...f, payout: f.payout.trim() || from };
      // simulate the launch first so no fee is charged for a launch that would fail
      if (isC) setSt({ step: `Preparing ${PL} launch…` });
      // contractURI JSON (image, description, links) — o1 shows the token from it
      const contractURI = isC ? await pinContractMeta(contractMeta(form, img.uri)) : '';
      const tx = isC ? await buildTaxTx(pf, chainId, { account: from, form, image: img.uri, quoteIn, contractURI }) : await buildLaunchTx({ account: from, form, logo: img.uri, quoteIn, exempt: wlParsed.list.map(a => getAddress(a)) });
      // unused credit (fee paid, not yet launched) → don't charge again
      const left = CHECKFEE_FEE_ON ? await launchCredits(from, chainId) : Infinity;
      if (left > 0) {
        setSt({ step: 'Confirm the launch in MetaMask…' });
      } else {
        setSt({ step: 'Step 1/2: CheckFee service fee 0.00003 ETH…' });
        const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: CHECKFEE_WALLET, value: '0x' + CHECKFEE_LAUNCH_FEE.toString(16) }] });
        const rc0 = await waitOn(chainId, h);
        if (rc0.status !== 'success') throw new Error('Service fee transfer failed');
        markFeePaid(from, chainId);
        setCredits(1);
        setSt({ step: 'Step 2/2: confirm the launch in MetaMask…' });
      }
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] });
      setSt({ step: 'Waiting for on-chain confirmation…', hash });
      const rc = await waitOn(chainId, hash);
      if (rc.status !== 'success') throw new Error('Launch transaction failed');
      clearFeePaid(from, chainId);
      try { localStorage.removeItem(DRAFT); } catch {}
      const L = isC ? parseTaxLaunch(pf, chainId, rc.logs) : parseLaunch(rc.logs);
      // add it to the site's launch list (server side)
      if (L?.token) await recordLaunch({ chainId, platform: pf, token: L.token, poolId: L.poolId, curve: L.curve, deployer: from, block: rc.blockNumber, txHash: hash });
      // Pons: optional unlimited approve of the bought tokens to the curve, so later sells need one signature
      let apNote = '';
      if (!isC && f.autoApprove && Number(f.buy) > 0 && L?.token && L.curve) {
        try {
          setSt({ step: 'Auto-approve: allow the curve to sell your tokens…', hash });
          const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: L.token, data: approveData(L.curve, 2n ** 256n - 1n), value: '0x0' }] });
          if ((await waitOn(chainId, h)).status !== 'success') throw new Error('approve reverted');
        } catch (er) {
          apNote = `Token launched, but auto-approve was skipped (${er.code === 4001 ? 'cancelled' : er.shortMessage || er.message}). You can approve on your first sell.`;
        }
      }
      const note = (L?.token && holders ? await shareWithHolders(eth, from, L.token) : '') || apNote;
      if (note) { setSt({ step: '', hash, token: '', err: note, link: `/launches/${L.token}` }); return; }
      if (L?.token) { location.href = `/launches/${L.token}${chainId === 4663 ? '' : `?chain=${chainId}`}`; return; } // go straight to the token page
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
                <a className="pill" href={`${CHAINS[chainId].explorer}/tx/${st.hash}`} target="_blank" rel="noreferrer">Tx <IconExternal /></a>
              </div>
            </div>
          </div>
          <div className="kv">
            <span>Creator fee wallet</span><span className="mono">{f.payout || w.account}</span>
          </div>
        </div>
        <p className="hint"><a href="/launch" onClick={() => location.reload()}>← Launch another token</a></p>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={IconBolt} title="Launch token" desc={isC
        ? `Create a token on ${PL} (Uniswap v4, ETH pair). Your share of the buy/sell fee goes straight to your fee wallet.`
        : 'Create a token on Pons v2 (ETH pair). Creator fees go straight to your wallet (Pons keeps 30% of the base fee), claimable at normal cost.'} />
      <div className="seg" style={{ marginBottom: 16 }}>
        {Object.entries(PLATFORMS).map(([k, v]) => <button key={k} type="button" className={pf === k ? 'on' : ''} onClick={() => { setPf(k); if (TAX[k]) setF(v => (Number(v.fee) < 1 ? { ...v, fee: 1 } : v)); }} disabled={!!st.step}>{v}</button>)}
      </div>
      <div className="net-row">
        <span className="muted small">Network</span>
        {isC
          ? <div className="seg">{CHAIN_IDS.map(id => <button key={id} type="button" className={chainId === id ? 'on' : ''} onClick={() => setNet(id)} disabled={!!st.step}><ChainIcon id={id} className="chain-ic" />{CHAINS[id].name}</button>)}</div>
          : <ChainBadge id={4663} />}
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
            <label><L icon={IconGlobe}>Website</L><span style={{ display: 'flex', gap: 6 }}><input style={{ flex: 1, minWidth: 0 }} value={f.website} onChange={set('website')} placeholder="https://…" />
              <button type="button" onClick={autofill} disabled={!f.website.trim() || scan.busy || !!st.step}>{scan.busy ? 'Scanning…' : 'Auto-fill'}</button></span>
              {scan.msg && <small className="muted">{scan.msg}</small>}</label>
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
            <p className="muted small">{isC ? `Charged on every buy and sell, ${PL}'s cut included (minimum 1%).` : 'Charged on every trade on top of the 1% Pons base fee.'}</p>
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
            <label><L icon={IconWallet}>Creator fee wallet</L><input className="mono" value={f.payout} onChange={set('payout')} placeholder={w.account ? `Connected wallet (${short(w.account)})` : 'Connected wallet'} /></label>
            <p className="muted small">{isC ? 'Receives the creator share of the trading fee (in ETH), claimable on the token page.' : 'Receives 70% of the base fee + 100% of the creator fee, claimable on the Check pages and the token page.'} Leave empty to use the connected wallet; paste an address only to send fees elsewhere.</p>
          </>}
          {!isC && (
            <label><L icon={IconLayers}>Whitelisted wallets (optional, up to {MAX_EXEMPT})</L>
              <textarea className="mono" rows={3} value={wl} onChange={e => setWl(e.target.value)} placeholder={'0x…\n0x…'} />
              <small className="muted">Exempt from the snipe tax at launch, e.g. your team's bundle wallets. The launching wallet and the fee wallet are always exempt. {wlParsed.list.length > 0 && `${wlParsed.list.length}/${MAX_EXEMPT}`}</small>
              {wlParsed.bad.length > 0 && <small className="err">Invalid: {wlParsed.bad.slice(0, 3).join(', ')}</small>}
              {wlParsed.list.length > MAX_EXEMPT && <small className="err">Pons allows up to {MAX_EXEMPT} wallets.</small>}
            </label>
          )}
          <label><L icon={IconCart}>Buy at launch (ETH, optional)</L><input type="number" min="0" step="0.001" value={f.buy} onChange={set('buy')} placeholder="0" /></label>
          {!isC && Number(f.buy) > 0 && (
            <label className="check"><input type="checkbox" checked={!!f.autoApprove} onChange={set('autoApprove')} />
              <span><b>Auto-approve after launch</b><br /><small className="muted">One extra MetaMask confirmation right after the launch: approves the curve to sell your bought tokens, so your first sell needs only one signature.</small></span></label>
          )}

          <div className="sum">
            <div><span className="lbl"><IconSpark />{isC ? `${PL} token creation fee` : 'Ponsfamily token creation fee'}</span><b>{info ? `${formatEther(info.launchFee)} ETH` : '…'}</b></div>
            <div><span className="lbl"><IconCart />First buy</span><b>{fmt(quoteIn)} ETH</b></div>
            {CHECKFEE_FEE_ON && <div><span className="lbl"><IconReceipt />CheckFee service fee</span><b>{credits == null && w.account ? '…' : free ? <span className="ok">free{Number.isFinite(credits) ? ` (${credits} credit${credits > 1 ? 's' : ''} left)` : ''}</span> : `${formatEther(CHECKFEE_LAUNCH_FEE)} ETH`}</b></div>}
            <div><span className="lbl"><IconBolt width={15} height={15} />Total{free ? '' : ' (2 transactions)'}, excl. gas</span><b className="accent">{total != null ? `${formatEther(total)} ETH` : '…'}</b></div>
          </div>
          {info && !info.canLaunch && <ErrorLine msg={isC ? `${PL} launches are currently closed.` : 'Pons currently only allows whitelisted wallets to launch.'} />}
          {!w.account && <p className="hint">Click <b>Connect Wallet</b> in the sidebar to launch.</p>}
          <button className="btn-primary big-btn" disabled={!ready}><IconBolt />{st.step || 'Launch with MetaMask'}</button>
          {st.hash && <a className="mono small" href={`${CHAINS[chainId].explorer}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 14)}…</a>}
          {!lenOk && <ErrorLine msg={`${PLATFORMS[pf]} allows a name up to ${lim.name} and a ticker up to ${lim.symbol} characters.`} />}
          {st.err && <ErrorLine msg={st.err} />}
          {st.link && <a className="pill" href={st.link}>Open the token page</a>}
        </div>
      </form>
    </>
  );
}
