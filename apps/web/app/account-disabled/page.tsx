import { SignOutButton } from "@/components/sign-out-button";

export default function AccountDisabledPage() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7f8", padding: 24 }}><article style={{ maxWidth: 560, background: "white", border: "1px solid #dfe7e2", borderRadius: 16, padding: 28 }}><h1>Account disabled</h1><p>Your access to the workspace application has been disabled by a platform administrator. Contact support or your service owner if you believe this is unexpected.</p><SignOutButton /></article></main>;
}
