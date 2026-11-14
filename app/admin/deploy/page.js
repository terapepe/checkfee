'use client';
// Internal page: deploy CheckfeeSplitterFactory with MetaMask (one-time)
import { useState, Fragment } from 'react';
import { encodeDeployData } from 'viem';
import art from '../../../contracts/CheckfeeSplitter.artifacts.json';
import { PageHeader, EXPLORER, useWallet } from '../../ui';
import { IconBolt } from '../../icons';

const ARGS = {
  treasury: '0x9F3C66dc59DE9E057C71659a33637213f8C646A0',
  ponsFactory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  ponsHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
  ponsEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
};
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json());

export default function DeployFactory() {
  const w = useWallet();
  const [st, setSt] = useState({ busy: false, hash: '', addr: '', err: '' });

  async function deploy() {
    const eth = window.ethereum;
    if (!eth) return setSt({ err: 'MetaMask not found' });
    setSt({ busy: true });
    try {
      const [from] = await eth.request({ method: 'eth_requestAccounts' });
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      const F = art.CheckfeeSplitterFactory;
      const data = encodeDeployData({ abi: F.abi, bytecode: F.bytecode, args: [ARGS.treasury, ARGS.ponsFactory, ARGS.ponsHook, ARGS.ponsEscrow] });
      const hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from, data, value: '0x0' }] });
      setSt({ busy: true, hash });
      for (let i = 0; i < 60; i++) {
        const r = (await rpc('eth_getTransactionReceipt', [hash])).result;
        if (r) {
          if (r.status !== '0x1') throw new Error('Deploy transaction failed');
          return setSt({ busy: false, hash, addr: r.contractAddress });
        }
        await new Promise(res => setTimeout(res, 2000));
      }
      setSt({ busy: false, hash, err: 'No receipt yet, check Blockscout' });
    } catch (e) {
      setSt({ busy: false, err: e.code === 4001 ? 'Cancelled in MetaMask' : (e.message || String(e)) });
    }
  }

  return (
    <>
      <PageHeader icon={IconBolt} title="Deploy CheckfeeSplitterFactory" desc="One-time setup. The factory creates a 90% creator / 10% CheckFee fee splitter per creator wallet." />
      <div className="card">
        <div className="kv" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          {Object.entries(ARGS).map(([k, v]) => (<Fragment key={k}><span>{k}</span><span className="mono">{v}</span></Fragment>))}
          <span>Connected wallet</span><span className="mono">{w.account || '—'}</span>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={deploy} disabled={st.busy}><IconBolt />{st.busy ? 'Deploying…' : 'Deploy with MetaMask'}</button>
          {st.hash && <a className="mono small" href={`${EXPLORER}/tx/${st.hash}`} target="_blank" rel="noreferrer">tx {st.hash.slice(0, 12)}…</a>}
        </div>
        {st.addr && <p className="ok">Factory: <a className="mono" href={`${EXPLORER}/address/${st.addr}`} target="_blank" rel="noreferrer">{st.addr}</a> — send this address to Claude.</p>}
        {st.err && <p className="err">{st.err}</p>}
      </div>
    </>
  );
}
