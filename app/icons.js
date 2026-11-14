// Bộ icon SVG nội tuyến (stroke = currentColor)
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

// Avatar token: màu suy ra từ địa chỉ, chữ cái đầu của symbol
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
