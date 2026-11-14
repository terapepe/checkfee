import './globals.css';
import { WalletProvider, Shell } from './ui';

export const metadata = {
  title: 'CheckFee v1',
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
