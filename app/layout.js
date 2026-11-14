import './globals.css';

export const metadata = {
  title: 'Pons Fee Checker',
  description: 'Kiểm tra và claim phí creator Pons v2 trên Robinhood Chain',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
