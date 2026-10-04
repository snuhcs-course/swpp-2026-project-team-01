import { redirect } from 'next/navigation'
import { Header } from '@/components/Header'
import { requireActor } from '@/server/session'
import { DomainError } from '@/contracts/common'
export default async function ProtectedLayout({children}:{children:React.ReactNode}) {
 try {await requireActor()} catch(e) {if(e instanceof DomainError && e.code==='unauthenticated')redirect('/login');throw e}
 return (
  <>
   <Header />
   <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">{children}</main>
  </>
 )
}
