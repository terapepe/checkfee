import './globals.css';
import { WalletProvider, Shell } from './ui';

export const metadata = {
  title: 'Pons Fee Checker',
  description: 'Kiểm tra và claim phí creator Pons v2 trên Robinhood Chain',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <WalletProvider>
          <Shell>{children}</Shell>
        </WalletProvider>
      </body>
    </html>
  );
}
