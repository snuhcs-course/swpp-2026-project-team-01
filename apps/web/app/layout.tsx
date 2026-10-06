import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Find Me a Time',
  description: 'A thoughtful scheduling assistant. Your calendar, your final say.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
