// Inline SVG icon set (stroke = currentColor)
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const I = (paths, extra = {}) => props => <svg {...base} {...extra} {...props}>{paths}</svg>;

export const Logo = props => (
  <svg width="34" height="34" viewBox="0 0 40 40" {...props}>
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d4ff4f" />
        <stop offset="1" stopColor="#49d6a0" />
      </linearGradient>
    </defs>
    <path d="M20 2 36 11v18L20 38 4 29V11z" fill="url(#lg)" />
    <path d="M20 9 30 14.5v11L20 31l-10-5.5v-11z" fill="#0b0d10" />
    <path d="M15.5 20.5 19 24l6-7.5" fill="none" stroke="url(#lg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconWallet = I(<><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" /><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M16 13.5h2.5" /></>);
export const IconWallets = I(<><rect x="2.5" y="8" width="15" height="12" rx="2.2" /><path d="M6.5 8V6.2A2.2 2.2 0 0 1 8.7 4H19.3A2.2 2.2 0 0 1 21.5 6.2V14a2 2 0 0 1-2 2h-2" /><path d="M13 14h2" /></>);
export const IconCoin = I(<><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5h3.8a1.7 1.7 0 0 1 0 3.4H10.7a1.7 1.7 0 0 0 0 3.4h3.8M12 7.5v1.8M12 16.3v1.6" /></>);
export const IconExternal = I(<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>, { width: 14, height: 14 });
export const IconCopy = I(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>, { width: 14, height: 14 });
export const IconCheck = I(<path d="m5 12.5 4.5 4.5L19 7.5" />, { width: 14, height: 14 });
export const IconAlert = I(<><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></>, { width: 15, height: 15 });
export const IconRefresh = I(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>, { width: 14, height: 14 });
export const IconSearch = I(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconBolt = I(<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />, { width: 15, height: 15 });
export const IconPower = I(<><path d="M12 3v8" /><path d="M7 6.3a7 7 0 1 0 10 0" /></>, { width: 15, height: 15 });

// Token avatar: colour derived from the address, initials of the symbol
export function TokenAvatar({ address, symbol, size = 40 }) {
  const h = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h + 60) % 360;
  const id = `ta${address.slice(2, 10)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 75% 58%)`} />
          <stop offset="1" stopColor={`hsl(${h2} 70% 42%)`} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id})`} />
      <text x="20" y="25.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
        {(symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'}
      </text>
    </svg>
  );
}

// ---- Launch form icons (generic glyphs) ----
const S = { width: 15, height: 15 };
export const IconImage = I(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-8 8" /></>, { width: 22, height: 22 });
export const IconTag = I(<><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z" /><circle cx="8" cy="8" r="1.4" /></>, S);
export const IconHash = I(<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />, S);
export const IconText = I(<path d="M4 6h16M4 11h16M4 16h10" />, S);
export const IconAt = I(<><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" /></>, S);
export const IconSend = I(<><path d="M21 3 10 14" /><path d="M21 3 14.5 21 10 14 3 9.5z" /></>, S);
export const IconGlobe = I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>, S);
export const IconChat = I(<><path d="M20 12a7 7 0 0 1-10.2 6.2L4 20l1.6-4.9A7 7 0 1 1 20 12z" /><path d="M9 11h.01M12 11h.01M15 11h.01" /></>, S);
export const IconArch = I(<><path d="M4 20V7l8-4 8 4v13" /><path d="M9 20v-6a3 3 0 0 1 6 0v6" /></>, S);
export const IconPercent = I(<><path d="M19 5 5 19" /><circle cx="7" cy="7" r="2.2" /><circle cx="17" cy="17" r="2.2" /></>, S);
export const IconRecycle = I(<><path d="M20 12a8 8 0 0 1-13.7 5.7" /><path d="M4 12a8 8 0 0 1 13.7-5.7" /><path d="M18 3v4h-4M6 21v-4h4" /></>, S);
export const IconCart = I(<><path d="M3 4h2.5l2.2 11h10.6L20.5 8H7" /><circle cx="9.5" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>, S);
export const IconReceipt = I(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>, S);
export const IconSpark = I(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />, S);
export const IconLayers = I(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>, S);
export const IconInfo = I(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, { width: 16, height: 16 });

// Network badges (simple original marks, not the official logos): Base = blue, Robinhood Chain = lime
const ICON2 = { // Ethereum, BNB Chain
  1: { name: 'Ethereum', bg: '#627eea', path: <path d="M12 3.5 7.2 12 12 14.8 16.8 12zM7.2 13 12 20.5 16.8 13 12 15.8z" fill="#fff" /> },
  56: { name: 'BNB Chain', bg: '#f0b90b', path: <path d="m12 5 2 2-2 2-2-2zM8 9l2 2-2 2-2-2zm8 0 2 2-2 2-2-2zm-4 0 2 2-2 2-2-2zm0 6 2 2-2 2-2-2z" fill="#fff" /> },
};
export const chainName = id => ICON2[Number(id)]?.name || (Number(id) === 8453 ? 'Base' : 'Robinhood');
export function ChainIcon({ id, size = 16, ...p }) {
  const o = ICON2[Number(id)];
  if (o) return <svg width={size} height={size} viewBox="0 0 24 24" aria-label={o.name} role="img" {...p}><circle cx="12" cy="12" r="11" fill={o.bg} />{o.path}</svg>;
  const base = Number(id) === 8453;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={base ? 'Base' : 'Robinhood Chain'} role="img" {...p}>
      <circle cx="12" cy="12" r="11" fill={base ? '#2f6bff' : '#c8f53f'} />
      {base
        ? <path d="M8.5 6.8h4.3a2.6 2.6 0 0 1 1.2 4.9 2.8 2.8 0 0 1-1 5.5H8.5zM10.7 8.8v2.3h1.8a1.15 1.15 0 0 0 0-2.3zm0 4.2v2.4h2.1a1.2 1.2 0 0 0 0-2.4z" fill="#fff" />
        : <path d="M8.5 6.8h4.4a3 3 0 0 1 .9 5.8l2.1 4.6h-2.4l-1.8-4.3h-1v4.3H8.5zm2.2 2v2.6h2a1.3 1.3 0 0 0 0-2.6z" fill="#111" />}
    </svg>
  );
}
export const ChainBadge = ({ id, label = true }) => (
  <span className={`chain-badge ${({ 8453: 'base', 1: 'eth', 56: 'bnb' })[Number(id)] || 'rh'}`}><ChainIcon id={id} size={14} />{label && chainName(id)}</span>
);
