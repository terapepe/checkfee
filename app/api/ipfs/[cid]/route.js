// Proxy ảnh IPFS qua gateway Pinata riêng (key nằm ở server); CID bất biến nên cache lâu
const GATEWAY = process.env.PINATA_GATEWAY;
const KEY = process.env.PINATA_GATEWAY_KEY;

export async function GET(_req, { params }) {
  const { cid } = await params;
  if (!/^[a-zA-Z0-9]{32,100}$/.test(cid)) return new Response('bad cid', { status: 400 });
  const url = GATEWAY
    ? `https://${GATEWAY}/ipfs/${cid}${KEY ? `?pinataGatewayToken=${KEY}` : ''}`
    : `https://gateway.pinata.cloud/ipfs/${cid}`;
  const r = await fetch(url, { next: { revalidate: 31536000 } });
  if (!r.ok) return new Response('not found', { status: 404 });
  const type = r.headers.get('content-type') || 'application/octet-stream';
  if (!/^image\//.test(type)) return new Response('not an image', { status: 415 });
  return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
}
