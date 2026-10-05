import { redirect } from "next/navigation";
import { getAccount } from "@/lib/server/account";
import { getSession } from "@/lib/server/auth";
import OwnerDashboard from "./owner-dashboard";
export const dynamic = "force-dynamic";
export default async function OwnerPage() {
  const account = await getAccount();
  const session = await getSession();
  if (!session || session.role !== "owner") redirect(account ? "/account" : "/login");
  return <OwnerDashboard email={session.email} />;
}
