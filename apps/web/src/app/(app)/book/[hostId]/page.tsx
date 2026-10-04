import {notFound,redirect} from 'next/navigation'
import {currentUser,db} from '@/server/context'
import {getUser} from '@/server/repos/users'
import {all} from '@/server/db/client'
import {readSearch} from '@/server/services/search'
import {makeContext} from '@/server/runtime'
import {SearchWorkspace} from '@/components/SearchWorkspace'
export default async function HostPage({params,searchParams}:{params:Promise<{hostId:string}>;searchParams:Promise<{search?:string}>}){
 const {hostId}=await params,{search}=await searchParams,me=await currentUser(),host=await getUser(db(),hostId)
 if(!host)notFound();if(me.id===hostId)redirect('/book')
 const previous=await all<{id:string}>(db(),'SELECT id FROM booking_searches WHERE client_id=? AND host_id=? ORDER BY created_at DESC, id DESC LIMIT 10',[me.id,hostId])
 const initial=search?await readSearch(db(),me.id,search):null
 if(initial&&initial.hostId!==hostId)notFound()
 return <SearchWorkspace key={search??'new'} hostId={hostId} hostName={host.name} initial={initial} previous={previous}/>
}
