'use client';
// "Copy token": prefill the Launch form with this token's details (fee wallet left empty) and open it
import { IconCopy } from './icons';

const DRAFT = 'checkfee_launch_draft'; // same key the Launch page restores from
const FEES = [0, 1, 1.5, 2, 2.5, 3, 4, 5];

export function CopyTokenButton({ pf, chainId = 4663, t }) {
  function go() {
    const so = t.socials || {};
    const pick = k => (typeof so[k] === 'string' ? so[k] : '');
    // fee: nearest option the form offers, Clanker / o1 minimum 1%
    const want = Number(t.fee) || 0;
    const opts = FEES.filter(n => pf === 'pons' || n >= 1);
    const fee = opts.reduce((a, n) => (Math.abs(n - want) < Math.abs(a - want) ? n : a), opts[0]);
    const draft = {
      pf, net: Number(chainId),
      // only an ipfs:// image can be reused as-is; otherwise the user picks one again
      uri: /^ipfs:\/\/[a-zA-Z0-9]{32,100}/.test(t.image || '') ? t.image.split('/').slice(0, 3).join('/') : '',
      f: {
        name: (t.name || '').replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 64),
        symbol: (t.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16),
        description: (t.description || '').slice(0, 500),
        twitter: pick('twitter'), telegram: pick('telegram'), discord: pick('discord'), website: pick('website'), farcaster: pick('farcaster'),
        payout: '', fee, dest: t.buyback ? 'buyback' : 'wallet', buy: '',
      },
    };
    try { localStorage.setItem(DRAFT, JSON.stringify(draft)); } catch {}
    location.href = '/launch';
  }
  return <button type="button" className="pill pill-btn" onClick={go} title="Open Launch with this token's name, ticker, image, description, links and fee (fee wallet left empty)"><IconCopy />Copy token</button>;
}
