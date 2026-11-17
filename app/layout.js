import './globals.css';
import { WalletProvider, Shell } from './ui';

export const metadata = {
  title: { default: 'Check wallet · CheckFee v1', template: '%s · CheckFee v1' }, // per-route titles: app/*/layout.js
  description: 'Check and claim Pons v2 creator fees on Robinhood Chain',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
