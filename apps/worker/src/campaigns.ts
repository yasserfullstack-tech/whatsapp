import type { WorkerEnv } from "@wa/config";
import { createDatabase } from "@wa/db";
import {
  createCampaignDispatchQueue,
  createRedisClient,
  createSendQueue,
} from "@wa/queue";
import { startConnectionHealthMonitor } from "./connection-health";
import { createCampaignDispatchWorker } from "./campaign-dispatch-worker";
import { startCampaignReconciliation } from "./campaign-reconciliation";
import { createCampaignSendWorker } from "./campaign-send-worker";

type Database = ReturnType<typeof createDatabase>["db"];
type RedisClient = ReturnType<typeof createRedisClient>;

export {
  checkCampaignDeferral,
  createRecipientSnapshot,
} from "./campaign-snapshot";
export type {
  CampaignDeferralResult,
  SnapshotResult,
} from "./campaign-snapshot";

export function startCampaignWorkers(input: {
  db: Database;
  redis: RedisClient;
  env: WorkerEnv;
}) {
  const { db, redis, env } = input;
  const sendQueue = createSendQueue(env.REDIS_URL);
  const dispatchQueue = createCampaignDispatchQueue(env.REDIS_URL);
  const connectionHealthMonitor = startConnectionHealthMonitor({ db, env });
  const sendWorker = createCampaignSendWorker({ db, redis, env });
  const campaignDispatchWorker = createCampaignDispatchWorker({ db, env, sendQueue });
  const reconciliation = startCampaignReconciliation({ db, dispatchQueue });

  return {
    sendWorker,
    campaignDispatchWorker,
    async close() {
      reconciliation.close();
      connectionHealthMonitor.close();
      await Promise.all([
        sendWorker.close(true),
        campaignDispatchWorker.close(true),
        sendQueue.close(),
        dispatchQueue.close(),
      ]);
    },
  };
}
