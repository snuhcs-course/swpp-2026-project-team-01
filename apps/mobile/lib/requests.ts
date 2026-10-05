import { supabase } from './supabase';

export type BookingRequest = {
  id: string;
  title: string;
  purpose: string;
  duration_minutes: number;
  proposed_start_at: string | null;
  location: string | null;
  status: string;
  proposal_version?: number;
  requester_name?: string | null;
};

export async function getRequests(): Promise<BookingRequest[]> {
  const { data, error } = await supabase.from('booking_requests').select('id,title,purpose,duration_minutes,proposed_start_at,location,status,requester_name,proposal_version').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BookingRequest[];
}

export async function updateRequestStatus(id: string, status: 'approved' | 'rejected', expectedVersion: number) {
  const { error } = await supabase.rpc('respond_to_booking_request', { request_id: id, response: status, expected_version: expectedVersion });
  if (error) throw error;
}
