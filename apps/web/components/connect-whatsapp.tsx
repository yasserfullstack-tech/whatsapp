"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type EmbeddedSignupData = {
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras: { setup: Record<string, never>; sessionInfoVersion: string };
    },
  ): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type ConnectWhatsAppProps = {
  appId: string;
  configId: string;
  graphApiVersion: string;
};

export function ConnectWhatsApp({ appId, configId, graphApiVersion }: ConnectWhatsAppProps) {
  const router = useRouter();
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
    setStatus("Finishing WhatsApp connection…");
    setError(null);

    try {
      const response = await fetch("/api/meta/embedded-signup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ...signup }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not connect WhatsApp");
      }

      setStatus("WhatsApp connected");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect WhatsApp");
      setStatus(null);
    } finally {
      completingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    function initialize() {
      if (!window.FB) return;
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphApiVersion });
      setSdkReady(true);
    }

    window.fbAsyncInit = initialize;

    if (window.FB) {
      initialize();
    } else if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;

      let payload: unknown = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      if (!payload || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      if (record.type !== "WA_EMBEDDED_SIGNUP") return;

      if (record.event === "CANCEL") {
        setStatus(null);
        setError("WhatsApp connection was cancelled.");
        return;
      }

      if (record.event !== "FINISH" || !record.data || typeof record.data !== "object") return;
      const data = record.data as Record<string, unknown>;
      const wabaId = data.waba_id;
      const phoneNumberId = data.phone_number_id;
      const businessId = data.business_id;

      if (typeof wabaId !== "string" || typeof phoneNumberId !== "string") return;

      signupRef.current = {
        wabaId,
        phoneNumberId,
        ...(typeof businessId === "string" ? { businessId } : {}),
      };
      void complete();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, complete, graphApiVersion]);

  function connect() {
    setError(null);
    setStatus("Opening Meta…");

    if (!window.FB) {
      setError("Meta login is still loading. Try again in a moment.");
      setStatus(null);
      return;
    }

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setStatus(null);
          setError("Meta did not return an authorization code.");
          return;
        }
        codeRef.current = code;
        setStatus("Meta authorized. Finishing setup…");
        void complete();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div className="connectActions">
      <button className="secondary" disabled={!sdkReady || Boolean(status)} onClick={connect} type="button">
        {status ?? (sdkReady ? "Connect WhatsApp" : "Loading Meta…")}
      </button>
      {error ? <span className="inlineError">{error}</span> : null}
    </div>
  );
}
