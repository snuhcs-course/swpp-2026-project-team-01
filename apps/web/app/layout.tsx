import type { Metadata } from 'next';
import './globals.css';
import { Geist_Mono, Merriweather } from "next/font/google";
import { cn } from "@web/lib/utils";

const geistMono = Geist_Mono({subsets:['latin'],variable:'--font-geist-mono'});
const merriweather = Merriweather({subsets:['latin'],variable:'--font-merriweather'});

export const metadata: Metadata = {
  title: 'Find Me a Time',
  description: 'A thoughtful scheduling assistant. Your calendar, your final say.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={cn("font-sans", geistMono.variable, merriweather.variable)}><body>{children}</body></html>;
}
