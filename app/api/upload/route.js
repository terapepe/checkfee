// Upload token images to IPFS via Pinata (JWT stays on the server)
export const dynamic = 'force-dynamic';

const JWT = process.env.PINATA_JWT;
const GATEWAY = process.env.PINATA_GATEWAY;
const GATEWAY_KEY = process.env.PINATA_GATEWAY_KEY;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const gatewayUrl = cid => GATEWAY
  ? `https://${GATEWAY}/ipfs/${cid}${GATEWAY_KEY ? `?pinataGatewayToken=${GATEWAY_KEY}` : ''}`
  : `https://ipfs.io/ipfs/${cid}`;

// GET: check config + JWT validity
export async function GET() {
  const env = { PINATA_JWT: !!JWT, PINATA_GATEWAY: !!GATEWAY, PINATA_GATEWAY_KEY: !!GATEWAY_KEY };
  if (!JWT) return Response.json({ ok: false, env, error: 'PINATA_JWT is missing' }, { status: 500 });
  const r = await fetch('https://api.pinata.cloud/data/testAuthentication', { headers: { Authorization: `Bearer ${JWT}` } });
  const j = await r.json().catch(() => ({}));
  return Response.json({ ok: r.ok, env, pinata: r.ok ? j.message : (j.error?.reason || j.error || `HTTP ${r.status}`) }, { status: r.ok ? 200 : 502 });
}

// POST multipart (field "file"): returns ipfs://CID for the launch params
// POST application/json: token metadata JSON (contractURI, o1 format) → ipfs://CID
export async function POST(req) {
  if (!JWT) return Response.json({ error: 'Server is missing PINATA_JWT' }, { status: 500 });
  if ((req.headers.get('content-type') || '').includes('application/json')) return pinJson(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return Response.json({ error: 'Missing image file' }, { status: 400 });
  if (!TYPES.includes(file.type)) return Response.json({ error: 'Only PNG, JPG, WEBP, GIF are accepted' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'Image must be 2MB or smaller' }, { status: 400 });

  const body = new FormData();
  body.append('file', file, file.name || 'token-image');
  body.append('pinataMetadata', JSON.stringify({ name: `img-${Date.now()}` }));
  const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST', headers: { Authorization: `Bearer ${JWT}` }, body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.IpfsHash) {
    return Response.json({ error: j.error?.reason || j.error?.details || j.error || `Pinata HTTP ${r.status}` }, { status: 502 });
  }
  return Response.json({ cid: j.IpfsHash, uri: `ipfs://${j.IpfsHash}`, url: gatewayUrl(j.IpfsHash) });
}

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
async function pinJson(req) {
  const j = await req.json().catch(() => null);
  if (!j || !str(j.name, 64) || !str(j.symbol, 16)) return Response.json({ error: 'Missing name / symbol' }, { status: 400 });
  // only the fields a token page needs, size-capped
  const links = Object.fromEntries(['website', 'twitter', 'telegram', 'discord', 'farcaster'].map(k => [k, str(j.links?.[k], 200)]).filter(([, v]) => v));
  const meta = {
    name: str(j.name, 64), symbol: str(j.symbol, 16), description: str(j.description, 500), standard: 'ERC20',
    image: /^ipfs:\/\/[a-zA-Z0-9]{32,100}$/.test(j.image || '') || /^https:\/\/pbs\.twimg\.com\/profile_images\/[\w/.-]{1,150}$/.test(j.image || '') ? j.image : '', links,
    // Pangea reads the links at the top level (website / twitter / telegram / discord)
    ...links, ...(links.website ? { external_url: links.website } : {}),
  };
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST', headers: { Authorization: `Bearer ${JWT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pinataContent: meta, pinataMetadata: { name: `meta-${Date.now()}` } }),
  });
  const o = await r.json().catch(() => ({}));
  if (!r.ok || !o.IpfsHash) return Response.json({ error: o.error?.reason || o.error?.details || o.error || `Pinata HTTP ${r.status}` }, { status: 502 });
  return Response.json({ cid: o.IpfsHash, uri: `ipfs://${o.IpfsHash}` });
}
