import { SignOutButton } from "@/components/sign-out-button";

export default function WorkspaceSuspendedPage() {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7f8", padding: 24 }}><article style={{ maxWidth: 560, background: "white", border: "1px solid #dfe7e2", borderRadius: 16, padding: 28 }}><h1>Workspace suspended</h1><p>This organization is temporarily suspended at the platform level. Messaging and authenticated workspace operations are blocked until a platform administrator reactivates it.</p><SignOutButton /></article></main>;
}
