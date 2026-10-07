import type { Metadata } from 'next';
import './globals.css';
import { Inter } from "next/font/google";
import { cn } from "@web/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-inter'});

export const metadata: Metadata = {
  title: 'Find Me a Time',
  description: 'A thoughtful scheduling assistant. Your calendar, your final say.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={cn("font-sans", inter.variable)}><body>{children}</body></html>;
}
