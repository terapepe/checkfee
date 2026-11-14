'use client';
import { useEffect, useState } from 'react';
import { parseEther, formatEther, isAddress } from 'viem';
import { useWallet, PageHeader, ErrorLine, EXPLORER, PONS, short, fmt } from '../ui';
import { IconBolt, IconExternal, TokenAvatar } from '../icons';
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

  const [credits, setCredits] = useState(null); // null = đang đọc
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
      setSt({ err: `Upload ảnh lỗi: ${er.message}` });
    }
  }

  let quoteIn = 0n;
  try { quoteIn = f.buy ? parseEther(String(f.buy)) : 0n; } catch {}
  const total = info ? info.launchFee + quoteIn + serviceFee : null;
  const payoutOk = isAddress(f.payout || '', { strict: false });
  const ready = w.account && f.name.trim() && f.symbol.trim() && img.uri && payoutOk && info?.canLaunch && credits != null && !st.step;

  async function launch(e) {
    e.preventDefault();
    setSt({ step: 'Đang giả lập giao dịch…' });
    try {
      const eth = window.ethereum;
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      // giả lập launch trước để không thu phí khi launch chắc chắn lỗi
      const tx = await buildLaunchTx({ account: from, form: f, logo: img.uri, quoteIn });
      // còn lượt miễn phí (đã trả phí mà chưa launch) thì không thu lại
      const left = await launchCredits(from);
      if (left > 0) {
        setSt({ step: 'Xác nhận launch trong MetaMask…' });
      } else {
        setSt({ step: 'Bước 1/2: phí dịch vụ checkfee 0.00003 ETH…' });
        const h = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: CHECKFEE_WALLET, value: '0x' + CHECKFEE_LAUNCH_FEE.toString(16) }] });
        const rc0 = await waitReceipt(h);
        if (rc0.status !== 'success') throw new Error('Chuyển phí dịch vụ thất bại');
        markFeePaid(from);
        setCredits(1);
        setSt({ step: 'Bước 2/2: xác nhận launch trong MetaMask…' });
      }
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data, value: '0x' + tx.value.toString(16) }] });
      setSt({ step: 'Đang chờ xác nhận on-chain…', hash });
      const rc = await waitReceipt(hash);
      if (rc.status !== 'success') throw new Error('Giao dịch launch thất bại');
      clearFeePaid(from);
      const L = parseLaunch(rc.logs);
      setSt({ step: '', hash, token: L?.token || '' });
    } catch (er) {
      setSt(s => ({ ...s, step: '', err: er.code === 4001 ? 'Đã huỷ trong MetaMask' : (er.shortMessage || er.message || String(er)) }));
    }
  }

  if (st.token) {
    return (
      <>
        <PageHeader icon={IconBolt} title="Launch thành công" desc="Token đã được tạo trên Pons v2. Phí creator về thẳng ví nhận phí của bạn." />
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
            <span>Ví nhận phí creator</span><span className="mono">{f.payout}</span>
          </div>
        </div>
        <p className="hint"><a href="/launch" onClick={() => location.reload()}>← Launch token khác</a></p>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={IconBolt} title="Launch token" desc="Tạo token trên Pons v2 (cặp ETH). Phí creator về thẳng ví của bạn (Pons giữ 30% phí gốc), claim rẻ như bình thường." />
      <form className="launch" onSubmit={launch}>
        <div className="card lf">
          <h3 style={{ marginTop: 0 }}>Thông tin token</h3>
          <div className="lf-row">
            <label className="img-pick">
              {img.preview ? <img src={img.preview} alt="" /> : <span>+ Ảnh<br /><small>PNG/JPG/WEBP/GIF ≤2MB</small></span>}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickImage} hidden />
              {img.uploading && <em className="badge">đang upload…</em>}
              {img.uri && <em className="badge">IPFS ✓</em>}
            </label>
            <div className="lf-col">
              <label>Tên token<input value={f.name} onChange={set('name')} maxLength={32} placeholder="NEXT AI" required /></label>
              <label>Ticker<input value={f.symbol} onChange={set('symbol')} maxLength={10} placeholder="NEXT" required /></label>
            </div>
          </div>
          <label>Mô tả<textarea rows={3} value={f.description} onChange={set('description')} maxLength={500} /></label>
          <div className="lf-grid">
            <label>X / Twitter<input value={f.twitter} onChange={set('twitter')} placeholder="https://x.com/…" /></label>
            <label>Telegram<input value={f.telegram} onChange={set('telegram')} placeholder="https://t.me/…" /></label>
            <label>Website<input value={f.website} onChange={set('website')} placeholder="https://…" /></label>
            <label>Discord<input value={f.discord} onChange={set('discord')} placeholder="https://discord.gg/…" /></label>
            <label>Farcaster<input value={f.farcaster} onChange={set('farcaster')} placeholder="https://warpcast.com/…" /></label>
          </div>
        </div>

        <div className="card lf">
          <h3 style={{ marginTop: 0 }}>Phí &amp; mua đầu</h3>
          <label>Ví nhận phí creator<input className="mono" value={f.payout} onChange={set('payout')} placeholder="0x…" /></label>
          <p className="muted small">Ví này nhận 70% phí giao dịch gốc + 100% creator tax, claim trực tiếp ở trang Check. Mặc định là ví đang kết nối.</p>
          <label>Creator tax: <b>{f.taxBps / 100}%</b>
            <input type="range" min={0} max={info?.maxTaxBps ?? 1000} step={50} value={f.taxBps} onChange={set('taxBps')} />
          </label>
          <label className="check"><input type="checkbox" checked={f.buyback} onChange={set('buyback')} /> Bật buyback (một phần phí creator dùng mua lại token, vest 5 năm)</label>
          <label>Mua ngay khi launch (ETH, tuỳ chọn)<input type="number" min="0" step="0.001" value={f.buy} onChange={set('buy')} placeholder="0" /></label>

          <div className="sum">
            <div><span>Phí khởi tạo token trên Ponsfamily</span><b>{info ? `${formatEther(info.launchFee)} ETH` : '…'}</b></div>
            <div><span>Mua đầu</span><b>{fmt(quoteIn)} ETH</b></div>
            <div><span>Phí dịch vụ checkfee</span><b>{credits == null && w.account ? '…' : free ? <span className="ok">miễn phí{Number.isFinite(credits) ? ` (còn ${credits} lượt)` : ''}</span> : `${formatEther(CHECKFEE_LAUNCH_FEE)} ETH`}</b></div>
            <div><span>Tổng{free ? '' : ' (2 giao dịch)'}, chưa gồm gas</span><b className="accent">{total != null ? `${formatEther(total)} ETH` : '…'}</b></div>
          </div>
          {info && !info.canLaunch && <ErrorLine msg="Pons đang chỉ cho ví trong whitelist launch." />}
          {!w.account && <p className="hint">Bấm <b>Connect Wallet</b> ở thanh bên trái để launch.</p>}
          <button className="btn-primary big-btn" disabled={!ready}><IconBolt />{st.step || 'Launch bằng MetaMask'}</button>
          {st.hash && <a className="mono small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 14)}…</a>}
          {st.err && <ErrorLine msg={st.err} />}
        </div>
      </form>
    </>
  );
}
