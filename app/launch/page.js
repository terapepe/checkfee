'use client';
import { useEffect, useState } from 'react';
import { parseEther, formatEther, isAddress, getAddress } from 'viem';
import { useWallet, PageHeader, ErrorLine, EXPLORER, PONS, short, fmt, parseAddresses, getNativeUsd } from '../ui';
import { IconBolt, IconExternal, TokenAvatar, IconImage, IconTag, IconHash, IconText, IconAt, IconSend, IconGlobe, IconChat, IconArch, IconWallet, IconPercent, IconRecycle, IconCart, IconReceipt, IconLayers, IconCoin, IconSpark } from '../icons';

const L = ({ icon: Ic, children }) => <span className="lbl"><Ic />{children}</span>;
import { readLaunchInfo, buildLaunchTx, parseLaunch, waitReceipt, CHECKFEE_LAUNCH_FEE, CHECKFEE_WALLET, CHECKFEE_FEE_ON } from '../../lib/launch';
import { launchCredits, markFeePaid, clearFeePaid } from '../../lib/credit';
import { recordLaunch, approveData } from '../../lib/market';
import { TAX, readTaxInfo, buildTaxTx, parseTaxLaunch, contractMeta, pinContractMeta } from '../../lib/tax';
import { CHAINS, CHAIN_IDS, switchChain, waitOn } from '../../lib/chains';
import { ChainIcon, ChainBadge, chainName } from '../icons';
import { SOL, launchPangeaSolana } from '../../lib/pangea-sol';
const MULTI = 'checkfee_pangea_multi'; // a multi-chain launch in progress (resume within the hour)
const SOL_ID = SOL.pcid; // Pangea's Solana pcid, used as the network id on this page
const PANGEA_NETS = [4663, 8453, 1, 56, SOL_ID];
import { distributorOf, createDistributorTx, routeToTx, MAX_EXEMPT } from '../../lib/launch';
import { readPangeaInfo, buildPangeaTx, buildPangeaOpenTx, pangeaPreimage, parsePangeaLaunch, PANGEA_START_MCAP_USD, PANGEA_CHAIN_IDS } from '../../lib/pangea';

const PLATFORMS = { pons: 'Pons', clanker: 'Clanker', o1: 'o1', pangea: 'Pangea' };
const DRAFT = 'checkfee_launch_draft';
// ticker: A-Z 0-9 only, uppercase · name: letters/digits/spaces only · contract limits per platform
const LIMIT = { pons: { name: 64, symbol: 16 }, clanker: { name: 64, symbol: 16 }, o1: { name: 64, symbol: 16 }, pangea: { name: 64, symbol: 16 } };
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

const EMPTY = { name: '', symbol: '', description: '', twitter: '', telegram: '', discord: '', website: '', farcaster: '', payout: '', fee: 1, dest: 'wallet', buy: '', autoApprove: false, zeroEcon: false, mcap: PANGEA_START_MCAP_USD, pquote: 'usdc' };

export default function Launch() {
  const w = useWallet();
  const [f, setF] = useState(EMPTY);
  const [img, setImg] = useState({ file: null, preview: '', uri: '', uploading: false });
  const [info, setInfo] = useState(null);
  const [pf, setPf] = useState('pons');
  const isC = !!TAX[pf]; // Clanker / o1: same v4 tax launch
  const isP = pf === 'pangea'; // Pangea v4: one chain per launch (Robinhood, Base, Ethereum, BNB Chain), no first buy
  const pons = pf === 'pons';
  const PL = PLATFORMS[pf];
  const [net, setNet] = useState(4663);
  const [pnet, setPnet] = useState(4663); // Pangea home chain
  const chainId = isC ? net : isP ? pnet : 4663; // Pons is Robinhood only
  // Pangea multi-chain: the same coin opened on several chains, each one signed and paid on that chain, within the hour
  const [pextra, setPextra] = useState([]);
  const plegs = isP ? [pnet, ...pextra.filter(x => x !== pnet)] : [];
  const phome = plegs.includes(SOL_ID) ? SOL_ID : pnet; // Solana first (Pangea's rule for a self-launch)
  const porder = [phome, ...plegs.filter(x => x !== phome)];
  const isPM = isP && plegs.length > 1;
  const isPS = isP && !isPM && chainId === SOL_ID; // Pangea on Solana only: Solana wallet
  const hasSol = isP && plegs.includes(SOL_ID);
  const sym = isPS ? 'SOL' : CHAINS[chainId]?.sym || 'ETH';
  // Pangea: which chains currently accept a self-launch (opensPaused read on each chain)
  const [popen, setPopen] = useState({});
  useEffect(() => {
    if (!isP) return;
    PANGEA_CHAIN_IDS.forEach(id => readPangeaInfo(id).then(i => setPopen(o => ({ ...o, [id]: i.canLaunch }))).catch(() => setPopen(o => ({ ...o, [id]: false }))));
  }, [isP]);
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
        if (PANGEA_NETS.includes(d.pnet)) setPnet(d.pnet);
        if (Array.isArray(d.pextra)) setPextra(d.pextra.filter(x => PANGEA_NETS.includes(x)));
        if (d.uri) setImg({ file: null, preview: d.uri.startsWith('ipfs://') ? `/api/ipfs/${d.uri.replace('ipfs://', '')}` : d.uri, uri: d.uri, uploading: false });
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT, JSON.stringify({ f: { ...f, payout: '' }, pf, net, pnet, pextra, uri: img.uri })); } catch {}
  }, [f, pf, net, pnet, pextra, img.uri, loaded]);

  const [credits, setCredits] = useState(null); // null = loading
  useEffect(() => {
    setInfo(null);
    (isC ? readTaxInfo(pf, chainId) : isPS ? Promise.resolve({ launchFee: 0n, canLaunch: true }) : isP ? readPangeaInfo(chainId) : readLaunchInfo(w.account)).then(setInfo).catch(() => {});
  }, [w.account, pf, chainId]);
  useEffect(() => {
    if (!CHECKFEE_FEE_ON) return setCredits(Infinity); // service fee off: every launch is free
    setCredits(null);
    if (w.account) launchCredits(w.account, chainId).then(setCredits).catch(() => setCredits(0));
  }, [w.account, chainId]);
  const free = credits != null && credits > 0;
  const serviceFee = free ? 0n : CHECKFEE_LAUNCH_FEE;

  // X profile picture as the token image: direct pbs.twimg.com link (no upload), looked up via unavatar from the browser
  const [xImg, setXImg] = useState('');
  async function loadXAvatar() {
    const h = f.twitter.trim().match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})|^@?([A-Za-z0-9_]{1,15})$/);
    const handle = h?.[1] || h?.[2];
    if (!handle) return setXImg('Enter an X link or @handle first');
    setXImg('Loading…');
    try {
      const j = await fetch(`https://unavatar.io/x/${handle}?json`).then(r => r.json());
      if (!/^https:\/\/pbs\.twimg\.com\/profile_images\//.test(j.url || '')) throw new Error(`No profile picture found for @${handle}`);
      setImg({ file: null, preview: j.url, uri: j.url, uploading: false });
      setXImg('');
    } catch (er) { setXImg(er.message || 'Lookup failed'); }
  }

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
  try { quoteIn = f.buy && !isP ? parseEther(String(f.buy)) : 0n; } catch {}
  const total = info ? info.launchFee + quoteIn + serviceFee : null;
  const holders = pons && f.dest === 'holders';
  // Pons whitelist: wallets exempt from the snipe tax at launch (not saved in the draft)
  const [wl, setWl] = useState('');
  const wlParsed = parseAddresses(wl);
  const wlOk = !pons || (!wlParsed.bad.length && wlParsed.list.length <= MAX_EXEMPT);
  // empty fee wallet = the connected wallet
  const payoutOk = holders || isPS || isPM || !f.payout.trim() || isAddress(f.payout.trim(), { strict: false });
  const lim = LIMIT[pf];
  const lenOk = f.name.trim().length <= lim.name && f.symbol.length <= lim.symbol;
  const feeOk = !(!pons && Number(f.fee) < 1) && !(isP && !(Number(f.mcap) > 0));
  const pmOk = !isPM || porder.filter(x => x !== SOL_ID).every(x => popen[x] !== false);
  const ready = (w.account || isPS) && pmOk && f.name.trim() && f.symbol.trim() && lenOk && feeOk && img.uri && payoutOk && wlOk && info?.canLaunch && credits != null && !st.step;

  async function launch(e) {
    e.preventDefault();
    if (isPM) return launchMulti();
    if (isPS) return launchSolana();
    setSt({ step: 'Simulating transaction…' });
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await switchChain(eth, chainId);
      const form = { ...f, payout: f.payout.trim() || from };
      // simulate the launch first so no fee is charged for a launch that would fail
      if (!pons) setSt({ step: `Preparing ${PL} launch…` });
      // contractURI JSON (image, description, links) — o1 shows the token from it
      const contractURI = !pons ? await pinContractMeta(contractMeta(form, img.uri)) : '';
      const tx = isP ? await pangeaTx(from, form, contractURI) : isC ? await buildTaxTx(pf, chainId, { account: from, form, image: img.uri, quoteIn, contractURI }) : await buildLaunchTx({ account: from, form, logo: img.uri, quoteIn, exempt: wlParsed.list.map(a => getAddress(a)) });
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
      const L = isC ? parseTaxLaunch(pf, chainId, rc.logs) : isP ? parsePangeaLaunch(rc.logs) : parseLaunch(rc.logs);
      // add it to the site's launch list (server side)
      if (L?.token) await recordLaunch({ chainId, platform: pf, token: L.token, poolId: L.poolId, curve: L.curve, deployer: from, block: rc.blockNumber, txHash: hash });
      // Pons: optional unlimited approve of the bought tokens to the curve, so later sells need one signature
      let apNote = '';
      if (pons && f.autoApprove && Number(f.buy) > 0 && L?.token && L.curve) {
        try {
          setSt({ step: 'Auto-approve: allow the curve to sell your tokens…', hash });
          const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: L.token, data: approveData(L.curve, 2n ** 256n - 1n), value: '0x0' }] });
          if ((await waitOn(chainId, h)).status !== 'success') throw new Error('approve reverted');
        } catch (er) {
          apNote = `Token launched, but auto-approve was skipped (${er.code === 4001 ? 'cancelled' : er.shortMessage || er.message}). You can approve on your first sell.`;
        }
      }
      const note = (L?.token && holders ? await shareWithHolders(eth, from, L.token) : '') || apNote;
      // hints for the token page: platform, chain, launch block → no detection / log scan needed
      const page = L?.token ? `/launches/${L.token}?pf=${pf}&chain=${chainId}&b=${rc.blockNumber}` : '';
      if (note) { setSt({ step: '', hash, token: '', err: note, link: page }); return; }
      if (L?.token) { location.href = page; return; } // go straight to the token page
      setSt({ step: '', hash, token: '' });
    } catch (er) {
      setSt(s => ({ ...s, step: '', err: er.code === 4001 ? 'Cancelled in MetaMask' : (er.shortMessage || er.message || String(er)) }));
    }
  }

  // Pangea on Solana: the user's Solana wallet opens it (creator from the start), 2 transactions
  async function launchSolana() {
    setSt({ step: 'Saving the token metadata…' });
    try {
      const uri = await pinContractMeta(contractMeta(f, img.uri));
      const evm = await window.ethereum?.request({ method: 'eth_accounts' }).then(a => a?.[0]).catch(() => null);
      const res = await launchPangeaSolana({
        name: f.name.trim(), symbol: f.symbol.trim(), uri, mcapUsd: Number(f.mcap), feeBps: Math.round(Number(f.fee) * 100),
        creatorEvm: evm && isAddress(evm) ? getAddress(evm) : null, quote: f.pquote, solUsd: f.pquote === 'sol' ? await getNativeUsd(SOL_ID) : null,
        onStep: step => setSt(s => ({ ...s, step })),
      });
      try { localStorage.removeItem(DRAFT); } catch {}
      setSt({ step: '', sol: res });
    } catch (er) {
      setSt(s => ({ ...s, step: '', err: er.code === 4001 || /reject|denied|cancel/i.test(er.message || '') ? 'Cancelled in the wallet' : (er.shortMessage || er.message || String(er)) }));
    }
  }

  // Pangea multi-chain: one preimage (one coinId, one token address), the home first, then each other chain opened directly
  // by the creator (the connected EVM wallet, the coin's creatorEvm) within the hour; each chain is signed and paid there
  async function launchMulti(resume = null) {
    const done = resume?.done ? [...resume.done] : [];
    const save = x => { try { localStorage.setItem(MULTI, JSON.stringify(x, (k, v) => typeof v === 'bigint' ? `${v}n` : v)); } catch {} };
    try {
      const eth = window.ethereum;
      if (!eth) throw new Error('MetaMask is needed for the EVM chains');
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      const creator = getAddress(from);
      const job = resume || {
        name: f.name.trim(), symbol: f.symbol.trim(), mcap: Number(f.mcap), feeBps: Math.round(Number(f.fee) * 100), quote: f.pquote,
        order: porder, creator, at: Date.now(), image: img.uri,
      };
      if (job.creator !== creator) throw new Error(`Connect ${short(job.creator)}, the wallet that started this launch`);
      if (!job.uri) { setSt({ step: 'Saving the token metadata…' }); job.uri = await pinContractMeta(contractMeta(f, img.uri)); }
      let pre = job.pre ? JSON.parse(JSON.stringify(job.pre), (k, v) => typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v) : null;
      for (const id of job.order) {
        if (done.some(d => d.id === id)) continue;
        const label = chainName(id);
        if (pre && Date.now() - job.at > 58 * 60_000) throw new Error(`More than an hour since the launch: ${label} can no longer be opened from here (on Pangea, the creator authorizes it from the home chain)`);
        if (id === SOL_ID) {
          const r = await launchPangeaSolana({
            name: job.name, symbol: job.symbol, uri: job.uri, mcapUsd: job.mcap, feeBps: job.feeBps, creatorEvm: creator, quote: job.quote,
            solUsd: job.quote === 'sol' ? await getNativeUsd(SOL_ID) : null, onStep: step => setSt(s => ({ ...s, step: `${label}: ${step}` })),
          });
          pre = r.pre; job.at = Date.now();
          done.push({ id, token: r.mint, tx: r.signature });
        } else {
          setSt(s => ({ ...s, step: `${label}: switch the network in MetaMask…` }));
          await switchChain(eth, id);
          if (!pre) {
            setSt(s => ({ ...s, step: 'Finding the 6ea token address (~15s)…' }));
            ({ pre } = await pangeaPreimage({ readId: id, homePcid: id, name: job.name, symbol: job.symbol, creator }));
            job.at = Date.now();
          }
          const usd = await getNativeUsd(id);
          if (!usd) throw new Error(`${CHAINS[id].sym} price unavailable, try again`);
          setSt(s => ({ ...s, step: `${label}: simulating…` }));
          const tx = await buildPangeaOpenTx({ chainId: id, account: creator, pre, name: job.name, symbol: job.symbol, metadataURI: job.uri, feeBps: job.feeBps, mcapEth: job.mcap / usd });
          setSt(s => ({ ...s, step: `${label}: confirm in MetaMask (gas in ${CHAINS[id].sym})…` }));
          const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] });
          setSt(s => ({ ...s, step: `${label}: waiting for confirmation…` }));
          const rc = await waitOn(id, hash);
          if (rc.status !== 'success') throw new Error(`${label}: the open transaction failed`);
          const L = parsePangeaLaunch(rc.logs);
          if (L?.token) await recordLaunch({ chainId: id, platform: 'pangea', token: L.token, poolId: L.poolId, deployer: creator, block: rc.blockNumber, txHash: hash }).catch(() => {});
          done.push({ id, token: L?.token, tx: hash, block: Number(rc.blockNumber) });
        }
        save({ ...job, pre, done });
        setSt(s => ({ ...s, multi: done }));
      }
      try { localStorage.removeItem(MULTI); localStorage.removeItem(DRAFT); } catch {}
      setSt({ step: '', multi: done, multiDone: true });
    } catch (er) {
      const msg = er.code === 4001 || /reject|denied|cancel/i.test(er.message || '') ? 'Cancelled in the wallet' : (er.shortMessage || er.message || String(er));
      setSt(s => ({ ...s, step: '', multi: done.length ? done : s.multi, err: done.length ? `${msg}. Opened so far: ${done.map(d => chainName(d.id)).join(', ')}. Press Continue to open the rest (within the hour).` : msg }));
    }
  }
  const [pending, setPending] = useState(null); // an unfinished multi-chain launch
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(MULTI) || 'null');
      if (j && Date.now() - j.at < 58 * 60_000 && j.done?.length && j.done.length < j.order.length) setPending(j); else localStorage.removeItem(MULTI);
    } catch {}
  }, [st.step]);

  // Pangea: start market cap in USD → the chain's native coin (ETH, BNB), then grind the 6ea salt + simulate
  async function pangeaTx(from, form, metadataURI) {
    const usd = await getNativeUsd(chainId);
    if (!usd) throw new Error(`${sym} price unavailable, try again`);
    setSt({ step: 'Finding a 6ea token address (~15s)…' });
    return buildPangeaTx({ chainId, account: from, name: form.name.trim(), symbol: form.symbol.trim(), creator: form.payout, metadataURI, feeBps: Math.round(Number(form.fee) * 100), mcapEth: Number(form.mcap) / usd });
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

  if (st.multiDone) {
    return (
      <>
        <PageHeader icon={IconBolt} title="Launch successful" desc={`${f.name || 'Your token'} is live on Pangea on ${st.multi.length} chains: the same coin, one creator, each chain opened from your wallet.`} />
        <div className="card">
          {st.multi.map(d => (
            <div key={d.id} className="kv" style={{ alignItems: 'center' }}>
              <span><ChainBadge id={d.id} /></span>
              <span className="mono small">
                {d.id === SOL_ID
                  ? <><a href={`https://www.pangea.trade/app/t/${d.token}`} target="_blank" rel="noreferrer">{d.token}</a> · <a href={`https://solscan.io/tx/${d.tx}`} target="_blank" rel="noreferrer">tx</a></>
                  : <><a href={`/launches/${d.token}?pf=pangea&chain=${d.id}&b=${d.block}`}>{d.token}</a> · <a href={`${CHAINS[d.id].explorer}/tx/${d.tx}`} target="_blank" rel="noreferrer">tx</a></>}
              </span>
            </div>
          ))}
        </div>
        <p className="hint"><a href="/launch" onClick={() => location.reload()}>← Launch another token</a></p>
      </>
    );
  }

  if (st.sol) {
    const r = st.sol;
    return (
      <>
        <PageHeader icon={IconBolt} title="Launch successful" desc="Your token is live on Pangea, on Solana (USDC pair). Your Solana wallet is the coin's creator and receives the creator fees." />
        <div className="card token">
          <div className="tk-head">
            <div className="tk-name">
              <b>{f.name}</b> <span className="muted">${f.symbol}</span> <ChainBadge id={SOL_ID} />
              <div className="tk-links">
                <span className="mono">{r.mint}</span>
                <a className="pill" href={`https://www.pangea.trade/app/t/${r.mint}`} target="_blank" rel="noreferrer">Pangea <IconExternal /></a>
                <a className="pill" href={`https://solscan.io/token/${r.mint}`} target="_blank" rel="noreferrer">Solscan <IconExternal /></a>
                <a className="pill" href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">Tx <IconExternal /></a>
              </div>
            </div>
          </div>
          <div className="kv">
            <span>Creator (Solana)</span><span className="mono">{r.wallet}</span>
            <span>EVM address (when opened later)</span><span className="mono">{r.evmToken}</span>
          </div>
        </div>
        <p className="hint"><a href="/launch" onClick={() => location.reload()}>← Launch another token</a></p>
      </>
    );
  }

  if (st.token) {
    return (
      <>
        <PageHeader icon={IconBolt} title="Launch successful" desc={`Your token is live on ${isP ? 'Pangea' : 'Pons v2'}. Creator fees go straight to your fee wallet.`} />
        <div className="card token">
          <div className="tk-head">
            <TokenAvatar address={st.token} symbol={f.symbol} />
            <div className="tk-name">
              <b>{f.name}</b> <span className="muted">${f.symbol}</span>
              <div className="tk-links">
                <span className="mono">{st.token}</span>
                {isP ? <a className="pill" href={`${CHAINS[chainId].explorer}/token/${st.token}`} target="_blank" rel="noreferrer">Token <IconExternal /></a>
                  : <a className="pill" href={`${PONS}/${st.token}`} target="_blank" rel="noreferrer">Pons <IconExternal /></a>}
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
      <PageHeader icon={IconBolt} title="Launch token" desc={isP
        ? isPM ? `One Pangea v4 coin on ${porder.map(chainName).join(' + ')}: ${chainName(porder[0])} is the home and opens first, then each other chain is opened from your wallet (the same token, one creator). Each chain is a separate signature paid in its own gas${hasSol ? ' (Solana: your Solana wallet, about 0.05 SOL)' : ''}; all must be opened within an hour of the first. No launch fee. Pangea keeps 20% of the trading fee.`
        : isPS ? 'Create a token on Pangea v4 on Solana (Meteora pool, USDC or SOL pair) from your own Solana wallet (MetaMask Solana or Phantom): no launch fee, about 0.05 SOL of rent and fees, 2 signatures. Your Solana wallet is the creator and gets the creator fees; the other chains stay listed and can be opened later on Pangea.'
        : `Create a token on Pangea v4 (Uniswap v4, ${sym} pair) on ${CHAINS[chainId].name} from your own wallet: no launch fee, gas only (paid in ${sym}). Pangea keeps 20% of the trading fee, the rest goes to your fee wallet. One chain per launch.`
        : isC
        ? `Create a token on ${PL} (Uniswap v4, ETH pair). Your share of the buy/sell fee goes straight to your fee wallet.`
        : 'Create a token on Pons v2 (ETH pair). Creator fees go straight to your wallet (Pons keeps 30% of the base fee), claimable at normal cost.'} />
      <div className="seg" style={{ marginBottom: 16 }}>
        {Object.entries(PLATFORMS).map(([k, v]) => <button key={k} type="button" className={pf === k ? 'on' : ''} onClick={() => { setPf(k); if (k !== 'pons') setF(v => (Number(v.fee) < 1 ? { ...v, fee: 1 } : v)); }} disabled={!!st.step}>{v}</button>)}
      </div>
      <div className="net-row">
        <span className="muted small">Network</span>
        {isC
          ? <div className="seg">{CHAIN_IDS.map(id => <button key={id} type="button" className={chainId === id ? 'on' : ''} onClick={() => setNet(id)} disabled={!!st.step}><ChainIcon id={id} className="chain-ic" />{CHAINS[id].name}</button>)}</div>
          : isP ? <div style={{ display: 'grid', gap: 8 }}>
            <div className="seg">{PANGEA_NETS.map(id => <button key={id} type="button" className={chainId === id ? 'on' : ''} onClick={() => { setPnet(id); setPextra(x => x.filter(y => y !== id)); }} disabled={!!st.step || popen[id] === false} title={popen[id] === false ? 'Pangea launches are closed on this chain right now' : ''}><ChainIcon id={id} className="chain-ic" />{chainName(id)}</button>)}</div>
            <div className="seg" style={{ flexWrap: 'wrap' }}><span className="muted small" style={{ alignSelf: 'center', marginRight: 6 }}>Also open on</span>{PANGEA_NETS.filter(id => id !== pnet).map(id => { const on = pextra.includes(id); return <button key={id} type="button" className={on ? 'on' : ''} onClick={() => setPextra(x => on ? x.filter(y => y !== id) : [...x, id])} disabled={!!st.step || popen[id] === false}>{on ? '✓ ' : ''}{chainName(id)}</button>; })}</div>
          </div>
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
              {img.uri && <em className="badge">{img.uri.startsWith('ipfs://') ? 'IPFS ✓' : 'X ✓'}</em>}
            </label>
            <div className="lf-col">
              <label><L icon={IconTag}>Token name</L><input value={f.name} onChange={set('name')} maxLength={lim.name} placeholder="NEXT AI" required /></label>
              <label><L icon={IconHash}>Ticker</L><input value={f.symbol} onChange={set('symbol')} maxLength={lim.symbol} placeholder="NEXT" required /></label>
            </div>
          </div>
          <label><L icon={IconText}>Description</L><textarea rows={3} value={f.description} onChange={set('description')} maxLength={500} /></label>
          <div className="lf-grid">
            <label><L icon={IconAt}>X / Twitter</L><span style={{ display: 'flex', gap: 6 }}><input style={{ flex: 1, minWidth: 0 }} value={f.twitter} onChange={set('twitter')} placeholder="https://x.com/…" />
              <button type="button" onClick={loadXAvatar} disabled={!f.twitter.trim() || img.uploading || !!st.step} title="Use this X account's profile picture as the token image (direct link, no IPFS upload)">Use as image</button></span>
              {xImg && <small className="muted">{xImg}</small>}</label>
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
            <L icon={IconPercent}>{!pons ? 'Trading fee (buy & sell)' : 'Creator fee'}: <b>{f.fee}%</b></L>
            <div className="seg">
              {FEES.map(n => <button key={n} type="button" className={Number(f.fee) === n ? 'on' : ''} disabled={!pons && n < 1} onClick={() => setF(v => ({ ...v, fee: n }))}>{n}%</button>)}
            </div>
            <p className="muted small">{isP ? 'Charged on every buy and sell; Pangea keeps 20% of it.' : isC ? `Charged on every buy and sell, ${PL}'s cut included (minimum 1%).` : 'Charged on every trade on top of the 1% Pons base fee.'}</p>
          </div>
          {pons && (
            <fieldset className="dest">
              <legend className="muted small">Where your creator fees go</legend>
              {DESTS.map(([k, t, d]) => (
                <label key={k} className="check"><input type="radio" name="dest" checked={f.dest === k} onChange={() => setF(v => ({ ...v, dest: k }))} />
                  <span><b>{t}</b><br /><small className="muted">{d}</small></span></label>
              ))}
            </fieldset>
          )}
          {hasSol && <label><L icon={IconCoin}>Solana pool pair</L>
            <div className="seg">{[['usdc', 'USDC'], ['sol', 'SOL']].map(([k, n]) => <button key={k} type="button" className={f.pquote === k ? 'on' : ''} onClick={() => setF(v => ({ ...v, pquote: k }))} disabled={!!st.step}>{n}</button>)}</div>
            <small className="muted">{f.pquote === 'sol' ? 'Paired with SOL (wrapped SOL): buyers pay in SOL, creator fees arrive as wrapped SOL. Opens with no USD route, like Pangea\'s own SOL pairs.' : 'Paired with USDC (Pangea\'s default): creator fees arrive in USDC.'}</small></label>}
          {isPS && <p className="muted small">Creator fees go to the Solana wallet that launches.</p>}
          {isPM && <p className="muted small">Multi-chain: the connected MetaMask wallet is the coin's creator and fee wallet on the EVM chains{hasSol ? ', your Solana wallet on Solana' : ''}.</p>}
          {!holders && !isPS && !isPM && <>
            <label><L icon={IconWallet}>Creator fee wallet</L><input className="mono" value={f.payout} onChange={set('payout')} placeholder={w.account ? `Connected wallet (${short(w.account)})` : 'Connected wallet'} /></label>
            <p className="muted small">{!pons ? `Receives the creator share of the trading fee (in ${sym}), claimable on the token page.` : 'Receives 70% of the base fee + 100% of the creator fee, claimable on the Check pages and the token page.'} Leave empty to use the connected wallet; paste an address only to send fees elsewhere.</p>
          </>}
          {pons && (
            <label><L icon={IconLayers}>Whitelisted wallets (optional, up to {MAX_EXEMPT})</L>
              <textarea className="mono" rows={3} value={wl} onChange={e => setWl(e.target.value)} placeholder={'0x…\n0x…'} />
              <small className="muted">Exempt from the snipe tax at launch, e.g. your team's bundle wallets. The launching wallet and the fee wallet are always exempt. {wlParsed.list.length > 0 && `${wlParsed.list.length}/${MAX_EXEMPT}`}</small>
              {wlParsed.bad.length > 0 && <small className="err">Invalid: {wlParsed.bad.slice(0, 3).join(', ')}</small>}
              {wlParsed.list.length > MAX_EXEMPT && <small className="err">Pons allows up to {MAX_EXEMPT} wallets.</small>}
            </label>
          )}
          {isP && <label><L icon={IconCoin}>Start market cap (USD)</L><input type="number" min="1" step="100" value={f.mcap} onChange={set('mcap')} />
            <small className="muted">{isPS ? 'Opening price of the USDC pool. ' : 'Opening price of the pool. '}Pangea's default is ${PANGEA_START_MCAP_USD.toLocaleString('en-US')}.</small></label>}
          {!isP && <label><L icon={IconCart}>Buy at launch (ETH, optional)</L><input type="number" min="0" step="0.001" value={f.buy} onChange={set('buy')} placeholder="0" /></label>}
          {pons && Number(f.buy) > 0 && (
            <label className="check"><input type="checkbox" checked={!!f.autoApprove} onChange={set('autoApprove')} />
              <span><b>Auto-approve after launch</b><br /><small className="muted">One extra MetaMask confirmation right after the launch: approves the curve to sell your bought tokens, so your first sell needs only one signature.</small></span></label>
          )}
          {pons && (
            <label className="check"><input type="checkbox" checked={!!f.zeroEcon} onChange={set('zeroEcon')} />
              <span><b>Skip economics check</b><br /><small className="muted">Sends expectedEconomics = 0. The launch no longer reverts if Pons changes its curve/fee terms while your transaction is pending; it uses whatever terms are live when it lands.</small></span></label>
          )}

          <div className="sum">
            <div><span className="lbl"><IconSpark />{!pons ? `${PL} token creation fee` : 'Ponsfamily token creation fee'}</span><b>{info ? `${formatEther(info.launchFee)} ${sym}` : '…'}</b></div>
            <div><span className="lbl"><IconCart />First buy</span><b>{fmt(quoteIn)} ETH</b></div>
            {CHECKFEE_FEE_ON && <div><span className="lbl"><IconReceipt />CheckFee service fee</span><b>{credits == null && w.account ? '…' : free ? <span className="ok">free{Number.isFinite(credits) ? ` (${credits} credit${credits > 1 ? 's' : ''} left)` : ''}</span> : `${formatEther(CHECKFEE_LAUNCH_FEE)} ETH`}</b></div>}
            <div><span className="lbl"><IconBolt width={15} height={15} />Total{free ? '' : ' (2 transactions)'}, excl. gas</span><b className="accent">{total != null ? `${formatEther(total)} ${sym}` : '…'}</b></div>
          </div>
          {info && !info.canLaunch && <ErrorLine msg={!pons ? `${PL} launches are currently closed.` : 'Pons currently only allows whitelisted wallets to launch.'} />}
          {!w.account && !isPS && <p className="hint">Click <b>Connect Wallet</b> in the sidebar to launch.</p>}
          <button className="btn-primary big-btn" disabled={!ready}><IconBolt />{st.step || (isPM ? `Launch on ${porder.length} chains` : isPS ? 'Launch on Solana' : 'Launch with MetaMask')}</button>
          {pending && !st.step && <button type="button" className="btn-ghost" onClick={() => launchMulti(pending)}>Continue: open {pending.order.filter(id => !pending.done.some(d => d.id === id)).map(chainName).join(', ')} for {pending.name}</button>}
          {st.hash && CHAINS[chainId] && <a className="mono small" href={`${CHAINS[chainId].explorer}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 14)}…</a>}
          {!lenOk && <ErrorLine msg={`${PLATFORMS[pf]} allows a name up to ${lim.name} and a ticker up to ${lim.symbol} characters.`} />}
          {st.err && <ErrorLine msg={st.err} />}
          {st.link && <a className="pill" href={st.link}>Open the token page</a>}
        </div>
      </form>
    </>
  );
}
