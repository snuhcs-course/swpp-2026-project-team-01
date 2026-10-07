import {notFound} from 'next/navigation';
import {publicHandle} from '../../../../lib/contracts/intake.ts';
import {PublicIntakeWorkspace} from '../../components/public-intake.tsx';
export const dynamic='force-dynamic';
export const metadata={title:'Request a meeting · Find Me a Time',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{handle:string}>}){
 const {handle}=await params;if(!publicHandle.safeParse(handle).success)notFound();
 return <PublicIntakeWorkspace key={handle} handle={handle}/>;
}
