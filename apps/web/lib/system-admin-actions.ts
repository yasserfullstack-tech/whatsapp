"use server";

import { revalidatePath } from "next/cache";
import { schema } from "@wa/db";
import { requirePlatformAdmin } from "./platform-admin";
import { campaignDispatchQueue, contactImportQueue, db } from "./server";

const retryableQueues = {
  "campaign-dispatch": campaignDispatchQueue,
  "contact-import": contactImportQueue,
} as const;

type RetryableQueueName = keyof typeof retryableQueues;

function requiredText(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function retryQueueJobAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const queueName = requiredText(formData, "queueName") as RetryableQueueName;
  const jobId = requiredText(formData, "jobId");
  const queue = retryableQueues[queueName];
  if (!queue) throw new Error("Queue is not approved for direct retry");

  const job = await queue.getJob(jobId);
  if (!job) throw new Error("Queue job not found");
  const state = await job.getState();
  if (state !== "failed") throw new Error(`Only failed queue jobs can be retried; current state is ${state}`);

  const failedReason = job.failedReason ?? null;
  const attemptsMade = job.attemptsMade;
  await job.retry();
  await db.insert(schema.platformAuditEvents).values({
    actorAuthUserId: actor.authUserId,
    action: "queue.retry_requested",
    targetType: "queue_job",
    targetId: `${queueName}:${jobId}`,
    metadata: { queueName, jobName: job.name, failedReason, attemptsMade },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/system");
  revalidatePath("/admin/audit");
}