# Inbound WhatsApp inbox

PR-014 adds a tenant-scoped customer inbox on top of the existing durable Meta webhook pipeline.

## Domain model

- `inbox_conversations` identifies one customer thread for one organization and one connected WhatsApp phone number.
- `inbox_messages` stores inbound messages and agent replies. `source` is explicit: `inbound`, `agent_reply`, or `campaign`.
- Campaign delivery remains owned by `campaign_recipients`; an agent reply is never represented as a campaign send. The `campaign` inbox source is reserved for future timeline projection without changing campaign ownership.
- `inbox_notes` stores internal notes and never sends their contents to Meta.
- `inbox_webhook_receipts` records which already-durable webhook events have completed inbox projection.

Every inbox table either carries `organization_id` directly or is reached from a row that is selected with the active organization. API mutations always constrain conversation/message updates by both resource ID and organization ID. Assignment additionally verifies that the selected user belongs to the same organization.

## Webhook and replay behavior

The API continues to verify, persist, deduplicate, and queue Meta webhooks using the existing webhook event store. The inbox runtime reads only webhook events that the primary webhook worker has marked processed.

Inbound messages use Meta `wamid` as an organization-scoped unique key. A replay can therefore reach the inbox runtime more than once, but only the successful first insert increments `unread_count` or emits the in-app notification. Inbox webhook receipts are written only after message/status projection succeeds; a failed projection remains eligible for retry.

Agent reply delivery states are monotonic: `pending -> submitted -> sent -> delivered -> read`. A late `sent` event cannot regress `delivered/read`, and a late failure cannot overwrite `delivered/read`.

## Supported inbound content

The inbox normalizer supports:

- text
- button replies
- interactive button/list replies
- image
- video
- audio
- document
- sticker
- other/unknown message types

For media, the application stores only Meta content references and safe metadata: media ID, MIME type, SHA-256 value, filename, and caption when supplied. PR-014 does **not** persist downloaded media bytes or expose an arbitrary media-download proxy. A later media delivery feature must fetch with the tenant's Meta credential, enforce size/content-type limits, authorize the requesting workspace, and avoid logging credentials or binary payloads.

## Agent replies

Agent replies are free-form WhatsApp text messages sent through the connected business phone number. The API:

1. requires `inbox.manage`;
2. verifies the conversation belongs to the active organization;
3. requires the conversation to be open;
4. requires a customer inbound message within the previous 24 hours;
5. requires a connected, authorized WhatsApp number;
6. decrypts the tenant-scoped credential only for the Meta request;
7. persists a `pending` outbound inbox message before the provider call;
8. records the returned Meta `wamid` and `submitted` state, or a safe failure message.

When the 24-hour customer-service window is closed, the UI directs the operator to use an approved template campaign instead of bypassing WhatsApp policy.

## Inbox operations

`/inbox` provides:

- conversation list ordered by recent activity;
- unread counts;
- search by customer name, phone, message text, and media caption;
- open/closed and assignment filters;
- full thread view with delivery state and media-reference labels;
- agent replies;
- assignment to workspace members;
- close/reopen;
- internal notes.

Viewers receive `inbox.read`. Owners, admins, and members receive `inbox.manage` in addition to read access.

## Notifications

A newly inserted inbound message creates an in-app notification for workspace members unless that user has an `inbound_message` preference disabling in-app delivery. The notification dedupe key is the inbound Meta message ID, so webhook replay cannot duplicate it. Full notification channel preferences and email expansion remain compatible with the notification-runtime phase.

## Validation

Automated coverage includes:

- Meta inbox parsing for profile and media references;
- text-reply payload construction;
- 24-hour reply-window enforcement;
- message preview behavior;
- sender normalization;
- monotonic delivery-state transitions.

Database constraints provide replay idempotency (`organization_id + wamid`) and tenant-scoped conversation uniqueness. API routes enforce tenant isolation and role checks at mutation boundaries.
