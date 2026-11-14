'use client';
import { useEffect, useState } from 'react';
import { parseEther, formatEther, isAddress } from 'viem';
import { useWallet, PageHeader, ErrorLine, EXPLORER, PONS, short, fmt } from '../ui';
import { IconBolt, IconExternal, TokenAvatar, IconImage, IconTag, IconHash, IconText, IconAt, IconSend, IconGlobe, IconChat, IconArch, IconWallet, IconPercent, IconRecycle, IconCart, IconReceipt, IconLayers, IconCoin, IconSpark } from '../icons';

const L = ({ icon: Ic, children }) => <span className="lbl"><Ic />{children}</span>;
import { readLaunchInfo, buildLaunchTx, parseLaunch, waitReceipt, CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET } from '../../lib/launch';
import { launchCredits, markFeePaid, clearFeePaid } from '../../lib/credit';

const EMPTY = { name: '', symbol: '', description: '', twitter: '', telegram: '', discord: '', website: '', farcaster: '', payout: '', taxBps: 0, buyback: false, buy: '' };

export default function Launch() {
  const w = useWallet();
  const [f, setF] = useState(EMPTY);
  const [img, setImg] = useState({ file: null, preview: '', uri: '', uploading: false });
  const [info, setInfo] = useState(null);
  const [st, setSt] = useState({ step: '', err: '', hash: '', token: '' });
  const set = k => e => setF(v => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const [credits, setCredits] = useState(null); // null = loading
  useEffect(() => { readLaunchInfo(w.account).then(setInfo).catch(() => {}); }, [w.account]);
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
  const payoutOk = isAddress(f.payout || '', { strict: false });
  const ready = w.account && f.name.trim() && f.symbol.trim() && img.uri && payoutOk && info?.canLaunch && credits != null && !st.step;

  async function launch(e) {
    e.preventDefault();
    setSt({ step: 'Simulating transaction…' });
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      // simulate the launch first so no fee is charged for a launch that would fail
      const tx = await buildLaunchTx({ account: from, form: f, logo: img.uri, quoteIn });
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
      const L = parseLaunch(rc.logs);
      setSt({ step: '', hash, token: L?.token || '' });
    } catch (er) {
      setSt(s => ({ ...s, step: '', err: er.code === 4001 ? 'Cancelled in MetaMask' : (er.shortMessage || er.message || String(er)) }));
    }
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
      <PageHeader icon={IconBolt} title="Launch token" desc="Create a token on Pons v2 (ETH pair). Creator fees go straight to your wallet (Pons keeps 30% of the base fee), claimable at normal cost." />
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
              <label><L icon={IconTag}>Token name</L><input value={f.name} onChange={set('name')} maxLength={32} placeholder="NEXT AI" required /></label>
              <label><L icon={IconHash}>Ticker</L><input value={f.symbol} onChange={set('symbol')} maxLength={10} placeholder="NEXT" required /></label>
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
          <label><L icon={IconWallet}>Creator fee wallet</L><input className="mono" value={f.payout} onChange={set('payout')} placeholder="0x…" /></label>
          <p className="muted small">This wallet receives 70% of the base trading fee + 100% of the creator tax, claimable directly on the Check pages. Defaults to the connected wallet.</p>
          <label><L icon={IconPercent}>Creator tax: <b>{f.taxBps / 100}%</b></L>
            <input type="range" min={0} max={info?.maxTaxBps ?? 1000} step={50} value={f.taxBps} onChange={set('taxBps')} />
          </label>
          <label className="check"><input type="checkbox" checked={f.buyback} onChange={set('buyback')} /><IconRecycle className="ic" /> Enable buyback (part of creator fees buys back the token, vested over 5 years)</label>
          <label><L icon={IconCart}>Buy at launch (ETH, optional)</L><input type="number" min="0" step="0.001" value={f.buy} onChange={set('buy')} placeholder="0" /></label>

          <div className="sum">
            <div><span className="lbl"><IconSpark />Ponsfamily token creation fee</span><b>{info ? `${formatEther(info.launchFee)} ETH` : '…'}</b></div>
            <div><span className="lbl"><IconCart />First buy</span><b>{fmt(quoteIn)} ETH</b></div>
            <div><span className="lbl"><IconReceipt />CheckFee service fee</span><b>{credits == null && w.account ? '…' : free ? <span className="ok">free{Number.isFinite(credits) ? ` (${credits} credit${credits > 1 ? 's' : ''} left)` : ''}</span> : `${formatEther(CHECKFEE_LAUNCH_FEE)} ETH`}</b></div>
            <div><span className="lbl"><IconBolt width={15} height={15} />Total{free ? '' : ' (2 transactions)'}, excl. gas</span><b className="accent">{total != null ? `${formatEther(total)} ETH` : '…'}</b></div>
          </div>
          {info && !info.canLaunch && <ErrorLine msg="Pons currently only allows whitelisted wallets to launch." />}
          {!w.account && <p className="hint">Click <b>Connect Wallet</b> in the sidebar to launch.</p>}
          <button className="btn-primary big-btn" disabled={!ready}><IconBolt />{st.step || 'Launch with MetaMask'}</button>
          {st.hash && <a className="mono small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 14)}…</a>}
          {st.err && <ErrorLine msg={st.err} />}
        </div>
      </form>
    </>
  );
}
