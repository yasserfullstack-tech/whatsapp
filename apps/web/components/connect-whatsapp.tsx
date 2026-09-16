"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  createEmbeddedSignupLoginOptions,
  parseEmbeddedSignupMessage,
  type EmbeddedSignupData,
  type EmbeddedSignupLoginOptions,
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
  const codeRef = useRef<string | null>(null);
  const signupRef = useRef<EmbeddedSignupData | null>(null);
  const completingRef = useRef(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = useCallback(async () => {
    const code = codeRef.current;
    const signup = signupRef.current;
    if (!code || !signup || completingRef.current) return;
    completingRef.current = true;
    setStatus(messages.connect.finishing);
    setError(null);
    try {
      const response = await fetch("/api/meta/embedded-signup/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...signup }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? messages.connect.failed);
      setStatus(messages.connect.connected);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.connect.failed);
      setStatus(null);
    } finally { completingRef.current = false; }
  }, [messages.connect, router]);

  useEffect(() => {
    function initialize() { if (!window.FB) return; window.FB.init({ appId, cookie: true, xfbml: false, version: graphApiVersion }); setSdkReady(true); }
    window.fbAsyncInit = initialize;
    if (window.FB) initialize();
    else if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script"); script.id = "facebook-jssdk"; script.async = true; script.defer = true; script.crossOrigin = "anonymous"; script.src = "https://connect.facebook.net/en_US/sdk.js"; document.body.appendChild(script);
    }
    function onMessage(event: MessageEvent) {
      const message = parseEmbeddedSignupMessage(event.origin, event.data);
      if (message.kind === "ignore") return;
      if (message.kind === "cancel") {
        codeRef.current = null;
        signupRef.current = null;
        setStatus(null);
        setError(messages.connect.cancelled);
        return;
      }
      if (message.kind === "error" || message.kind === "invalid") {
        codeRef.current = null;
        signupRef.current = null;
        setStatus(null);
        setError(messages.connect.failed);
        return;
      }

      signupRef.current = message.data;
      void complete();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, complete, graphApiVersion, messages.connect.cancelled, messages.connect.failed]);

  function connect() {
    codeRef.current = null;
    signupRef.current = null;
    setError(null);
    setStatus(messages.connect.openingMeta);
    if (!window.FB) { setError(messages.connect.metaLoading); setStatus(null); return; }
    window.FB.login((response) => {
      const code = response.authResponse?.code?.trim();
      if (!code) {
        codeRef.current = null;
        signupRef.current = null;
        setStatus(null);
        setError(messages.connect.noCode);
        return;
      }
      codeRef.current = code;
      setStatus(messages.connect.authorized);
      void complete();
    }, createEmbeddedSignupLoginOptions(configId));
  }

  return <div className="connectActions"><button className="secondary" disabled={!sdkReady || Boolean(status)} onClick={connect} type="button">{status ?? (sdkReady ? (buttonLabel ?? messages.connect.button) : messages.connect.loadingMeta)}</button>{error ? <span className="inlineError">{error}</span> : null}</div>;
}
