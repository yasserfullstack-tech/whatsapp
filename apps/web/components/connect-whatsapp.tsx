"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  createEmbeddedSignupLoginOptions,
  EmbeddedSignupAttemptTracker,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupAttemptOutcome,
  type EmbeddedSignupLoginOptions,
  type EmbeddedSignupReadyAttempt,
} from "@/lib/embedded-signup-client";

type FacebookLoginResponse = { authResponse?: { code?: string }; status?: string };
type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: EmbeddedSignupLoginOptions): void;
};
declare global { interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void } }
type ConnectWhatsAppProps = { appId: string; configId: string; graphApiVersion: string; buttonLabel?: string };

export function ConnectWhatsApp({ appId, configId, graphApiVersion, buttonLabel }: ConnectWhatsAppProps) {
  const router = useRouter();
  const { messages } = useI18n();
  const trackerRef = useRef<EmbeddedSignupAttemptTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new EmbeddedSignupAttemptTracker();

  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);

  const complete = useCallback(async (attempt: EmbeddedSignupReadyAttempt) => {
    setStatus(messages.connect.finishing);
    setError(null);
    try {
      const response = await fetch("/api/meta/embedded-signup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: attempt.code, ...attempt.signup }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? messages.connect.failed);

      trackerRef.current?.completionSucceeded(attempt.attemptId);
      setStatus(messages.connect.connected);
      router.refresh();
    } catch (cause) {
      const reload = trackerRef.current?.completionFailed(attempt.attemptId) ?? false;
      setRequiresReload(reload);
      const baseMessage = cause instanceof Error ? cause.message : messages.connect.failed;
      setError(reload ? `${baseMessage} ${messages.connect.reloadToRetry}` : baseMessage);
      setStatus(null);
    }
  }, [messages.connect, router]);

  const handleOutcome = useCallback((outcome: EmbeddedSignupAttemptOutcome) => {
    if (outcome.kind === "ignore" || outcome.kind === "pending") return;
    if (outcome.kind === "ready") {
      void complete(outcome);
      return;
    }

    setStatus(null);
    setRequiresReload(outcome.requiresReload);
    const baseMessage = outcome.reason === "cancelled"
      ? messages.connect.cancelled
      : outcome.reason === "no_code"
        ? messages.connect.noCode
        : messages.connect.failed;
    setError(outcome.requiresReload
      ? `${baseMessage} ${messages.connect.reloadToRetry}`
      : baseMessage);
  }, [complete, messages.connect]);

  useEffect(() => {
    function initialize() {
      if (!window.FB) return;
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphApiVersion });
      setSdkReady(true);
    }

    window.fbAsyncInit = initialize;
    if (window.FB) initialize();
    else if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    }

    function onMessage(event: MessageEvent) {
      const message = parseEmbeddedSignupMessage(event.origin, event.data);
      const source = event.source && typeof event.source === "object" ? event.source : null;
      handleOutcome(trackerRef.current!.acceptMessage(source, message));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, graphApiVersion, handleOutcome]);

  function connect() {
    if (requiresReload) {
      window.location.reload();
      return;
    }

    setError(null);
    setStatus(messages.connect.openingMeta);
    if (!window.FB) {
      setError(messages.connect.metaLoading);
      setStatus(null);
      return;
    }

    const attemptId = trackerRef.current!.begin();
    if (attemptId === null) {
      setRequiresReload(true);
      setStatus(null);
      setError(messages.connect.reloadToRetry);
      return;
    }

    try {
      window.FB.login((response) => {
        handleOutcome(trackerRef.current!.acceptLoginResponse(attemptId, response.authResponse?.code));
      }, createEmbeddedSignupLoginOptions(configId));
    } catch {
      handleOutcome(trackerRef.current!.abortAttempt(attemptId));
    }
  }

  const buttonText = status
    ?? (requiresReload
      ? messages.connect.reloadToRetry
      : sdkReady
        ? (buttonLabel ?? messages.connect.button)
        : messages.connect.loadingMeta);

  return <div className="connectActions">
    <button
      className="secondary"
      disabled={requiresReload ? false : !sdkReady || Boolean(status)}
      onClick={connect}
      type="button"
    >
      {buttonText}
    </button>
    {error ? <span className="inlineError">{error}</span> : null}
  </div>;
}
