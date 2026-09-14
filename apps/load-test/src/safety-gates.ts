async function runPreload(metaSendApiBaseUrl: string, code: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(
    ["bun", "--preload", "./apps/load-test/src/fetch-redirect.ts", "-e", code],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        META_SEND_API_BASE_URL: metaSendApiBaseUrl,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function main() {
  const remoteTarget = await runPreload(
    "https://graph.facebook.com",
    "console.error('load-test preload unexpectedly accepted a remote Meta target'); process.exit(91);",
  );
  if (remoteTarget.exitCode === 0 || !remoteTarget.stderr.includes("Remote load-test send targets are forbidden")) {
    throw new Error(`Remote Meta target was not rejected fail-closed (exit=${remoteTarget.exitCode})`);
  }

  const blockedMetaRequest = await runPreload(
    "http://127.0.0.1:4100",
    `try {
      await fetch("https://graph.facebook.com/v26.0/me");
      console.error("real Meta request unexpectedly escaped load-test preload");
      process.exit(92);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (!message.includes("Blocked real Meta/Facebook request during load testing")) throw error;
    }`,
  );
  if (blockedMetaRequest.exitCode !== 0) {
    throw new Error(`Non-send Meta request safety gate failed (exit=${blockedMetaRequest.exitCode}): ${blockedMetaRequest.stderr}`);
  }

  const blockedFacebookRequest = await runPreload(
    "http://127.0.0.1:4100",
    `try {
      await fetch("https://www.facebook.com/");
      console.error("real Facebook request unexpectedly escaped load-test preload");
      process.exit(93);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (!message.includes("Blocked real Meta/Facebook request during load testing")) throw error;
    }`,
  );
  if (blockedFacebookRequest.exitCode !== 0) {
    throw new Error(`Facebook host safety gate failed (exit=${blockedFacebookRequest.exitCode}): ${blockedFacebookRequest.stderr}`);
  }

  console.log(JSON.stringify({
    event: "load-test-safety-gates-passed",
    remoteMetaTargetRejected: true,
    directMetaRequestBlocked: true,
    directFacebookRequestBlocked: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
