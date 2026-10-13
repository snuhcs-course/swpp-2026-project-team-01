import { BookingWorkspace } from '../../../components/access-workspace.tsx';
export default async function Page({params}:{params:Promise<{bookingId:string}>}) {return <BookingWorkspace requestId={(await params).bookingId}/>;}
