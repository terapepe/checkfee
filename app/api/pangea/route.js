// Pangea v4 platform-paid ("sponsored") launch, proxied server-side: Pangea's Launch API answers 403 to cross-site
// browser requests, programs (no Origin header) are served. Body shapes follow Pangea's own Create page.
//   POST { action: 'quote', name, symbol, description, image, links, owner, feeBps, mcapUsd, openNow[] }
//        → pins the metadata on Pangea's IPFS (prepare refuses any other: doc_not_pinned), prices every leg, prepares
//   POST { action: 'submit', ticket, payTx }   → hands the paid launch over (402/424 while the payment is not seen yet)
//   GET  ?launchId=0x…                         → launch status
export const dynamic = 'force-dynamic';

const PANGEA = 'https://www.pangea.trade';
const KEY = process.env.PANGEA_KEY; // optional partner key (X-Pangea-Key)
const EVM_CHAINS = ['robinhood', 'base', 'ethereum', 'bsc', 'elysium'];
const HOME = 'robinhood';

const GATEWAY = process.env.PINATA_GATEWAY;
const GATEWAY_KEY = process.env.PINATA_GATEWAY_KEY;
const MAX_IMG = 2 * 1024 * 1024;

const hdr = (json = true) => ({ ...(json ? { 'content-type': 'application/json' } : {}), ...(KEY ? { 'X-Pangea-Key': KEY } : {}), accept: 'application/json' });
async function call(path, body) {
  const r = await fetch(PANGEA + path, body === undefined
    ? { headers: hdr(false), cache: 'no-store', signal: AbortSignal.timeout(30_000) }
    : { method: 'POST', headers: hdr(), body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(150_000) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, json: j };
}
const fail = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status });
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// CheckFee's image (ipfs:// on our Pinata, or an X profile picture) → base64 data URI, the only image form /api/metadata takes
async function imageDataUri(uri) {
  let url;
  if (/^ipfs:\/\/[a-zA-Z0-9]{32,100}$/.test(uri)) {
    const cid = uri.slice(7);
    url = GATEWAY ? `https://${GATEWAY}/ipfs/${cid}${GATEWAY_KEY ? `?pinataGatewayToken=${GATEWAY_KEY}` : ''}` : `https://gateway.pinata.cloud/ipfs/${cid}`;
  } else if (/^https:\/\/pbs\.twimg\.com\/profile_images\/[\w/.-]{1,150}$/.test(uri)) url = uri;
  else throw new Error('Token image missing');
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Token image could not be read (HTTP ${r.status})`);
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error('Token image must be PNG, JPG, WEBP or GIF');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMG) throw new Error('Token image must be 2MB or smaller');
  return `data:${type};base64,${buf.toString('base64')}`;
}

// start market cap (USD, per chain) → price of one token in the chain's native coin, 1e18-scaled
// same math as Pangea's page: priceUsdE18 = cap / 1B, quotePerTokenE18 = priceUsdE18 · 1e18 / nativeUsdE18
async function quotePerTokenE18(chain, mcapUsd) {
  const { ok, json } = await call(`/api/gap-price/quote-usd?chain=${chain}&set=v4b`);
  const usd = ok && json?.price?.priceUsdE18 ? BigInt(json.price.priceUsdE18) : 0n;
  if (usd <= 0n) throw new Error(`No USD price for ${chain}'s native coin right now, try again`);
  const priceUsdE18 = BigInt(Math.round(mcapUsd * 100)) * 10n ** 16n / 1_000_000_000n;
  return (priceUsdE18 * 10n ** 18n / usd).toString();
}

async function quote(b) {
  const name = str(b.name, 64), symbol = str(b.symbol, 16);
  const owner = str(b.owner, 42);
  const feeBps = Number(b.feeBps), mcapUsd = Number(b.mcapUsd);
  const openNow = [...new Set(Array.isArray(b.openNow) ? b.openNow : [])].filter(c => EVM_CHAINS.includes(c));
  if (!name || !symbol) return fail('Missing name / ticker');
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || /^0x0{40}$/.test(owner)) return fail('Invalid fee wallet');
  if (!Number.isInteger(feeBps) || feeBps < 30 || feeBps > 500) return fail('Trading fee must be 0.3% to 5%');
  if (!(mcapUsd > 0 && mcapUsd < 1e12)) return fail('Invalid start market cap');
  if (!openNow.includes(HOME)) openNow.unshift(HOME);

  let image;
  try { image = await imageDataUri(str(b.image, 300)); } catch (e) { return fail(e.message); }
  const links = b.links || {};
  const meta = await call('/api/metadata', {
    name, symbol, description: str(b.description, 500), image,
    website: str(links.website, 200), twitter: str(links.twitter, 200), telegram: str(links.telegram, 200),
  });
  if (!meta.ok || typeof meta.json.metadataURI !== 'string') {
    // Pangea's /api/metadata only serves its own site, and prepare only takes metadata pinned on Pangea's IPFS (doc_not_pinned):
    // a multi-chain launch from CheckFee needs Pangea to allow it (partner key in PANGEA_KEY or an allowlist on their side)
    const why = meta.json.error || `HTTP ${meta.status}`;
    return fail(`Pangea only stores coin metadata for launches made on pangea.trade (${why}), so CheckFee cannot start a multi-chain launch yet. Nothing was paid. Use "Robinhood only", or launch multi-chain directly on pangea.trade.`, 502, { code: 'pangea_metadata_blocked' });
  }

  let legs;
  try {
    legs = Object.fromEntries(await Promise.all(openNow.map(async c => [c, { quote: 'native', feeBps, quotePerTokenE18: await quotePerTokenE18(c, mcapUsd) }])));
  } catch (e) { return fail(e.message, 502); }

  // chains: [] = Pangea's default list (all six worlds listed, LZ + Hyperlane); unopened ones can be opened later
  const body = { oneTx: true, ownerEvm: owner, name, symbol, metadataURI: meta.json.metadataURI, home: HOME, chains: [], openNow, payChain: HOME, legs };
  const p = await call('/api/v1/launch/v4/sponsored/prepare', body);
  if (!p.ok) return fail(p.json.error || `Pangea prepare HTTP ${p.status}`, p.status >= 400 && p.status < 600 ? p.status : 502, { code: p.json.code });
  const q = p.json;
  // never let the user pay a quote that is not what was asked
  if (q.oneTx !== true) return fail('Pangea quote is not a one-transaction launch: nothing is paid', 502);
  if (q.fee?.chain !== HOME) return fail('Pangea quote is paid on another chain than Robinhood: nothing is paid', 502);
  const pay = q.fee?.pay;
  if (!pay || !/^0x[0-9a-fA-F]{40}$/.test(pay.to || '') || !/^0x[0-9a-fA-F]*$/.test(pay.data || '') || !/^(0x[0-9a-fA-F]+|\d+)$/.test(String(pay.value ?? '')))
    return fail('Pangea quote has no payment transaction', 502);
  if (q.fee.gasKept) return fail('Pangea quote asks a second payment: quote again', 502);
  return Response.json({
    launchId: q.launchId, ticket: q.ticket, coinId: q.coinId, openNow, metadataURI: meta.json.metadataURI,
    fee: { wei: String(BigInt(pay.value)), usd: q.fee.feeUsd ?? q.fee.costUsd ?? null, ttlSeconds: q.fee.ttlSeconds ?? null },
    pay: { to: pay.to, data: pay.data || '0x', value: '0x' + BigInt(pay.value).toString(16) },
  });
}

async function submit(b) {
  if (typeof b.ticket !== 'string' || !b.ticket) return fail('Missing ticket');
  if (!/^0x[0-9a-fA-F]{64}$/.test(b.payTx || '')) return fail('Missing payment transaction');
  const s = await call('/api/v1/launch/v4/sponsored/submit', { ticket: b.ticket, payTx: b.payTx });
  return Response.json(s.json, { status: s.status });
}

export async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b) return fail('Bad request');
  try {
    if (b.action === 'quote') return await quote(b);
    if (b.action === 'submit') return await submit(b);
  } catch (e) { return fail(e.message || 'Pangea request failed', 502); }
  return fail('Unknown action');
}

export async function GET(req) {
  const id = new URL(req.url).searchParams.get('launchId') || '';
  if (!/^0x[0-9a-fA-F]{8,128}$/.test(id)) return fail('Invalid launchId');
  const s = await call(`/api/v1/launch/status?launchId=${id}`);
  return Response.json(s.json, { status: s.status, headers: { 'cache-control': 'no-store' } });
}
