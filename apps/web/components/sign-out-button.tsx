"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const { messages } = useI18n();
  const [pending, setPending] = useState(false);
  return (
    <button className="textButton signOut" disabled={pending} onClick={async () => { setPending(true); await authClient.signOut(); router.push("/sign-in"); router.refresh(); }} type="button">
      {pending ? messages.signOut.pending : messages.signOut.idle}
    </button>
  );
}
