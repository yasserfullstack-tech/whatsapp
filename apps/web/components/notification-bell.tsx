"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { productionUiMessages } from "@/lib/i18n/production-ui";
import styles from "./notification-bell.module.css";

export function NotificationBell({ active = false }: { active?: boolean }) {
  const { locale, format } = useI18n();
  const copy = productionUiMessages[locale].notifications;
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { unread?: number };
      setUnread(Math.max(0, Number(payload.unread ?? 0)));
    } catch {
      // The bell is non-blocking; the notifications page remains the source of truth.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const countLabel = unread > 99 ? "99+" : String(unread);
  return (
    <div className={styles.wrapper}>
      <Link
        className={`${styles.link} ${active ? styles.active : ""}`}
        href="/notifications"
        aria-label={unread ? format(copy.unread, { count: unread }) : copy.label}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
        </span>
        <span className={styles.label}>{copy.label}</span>
        {unread > 0 ? <span className={styles.badge}>{countLabel}</span> : null}
      </Link>
    </div>
  );
}
