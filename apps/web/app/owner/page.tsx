import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/auth";
import OwnerDashboard from "./owner-dashboard";
export const dynamic = "force-dynamic";
export default async function OwnerPage() {
  const session = await getSession();
  if (!session || session.role !== "owner") redirect("/api/auth/google/start?role=owner");
  return <OwnerDashboard email={session.email} />;
}
