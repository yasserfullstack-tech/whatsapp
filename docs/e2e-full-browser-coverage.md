# Full-browser E2E coverage

Branch: `test/e2e-full-browser`

## Environment and safety

The functional Playwright suite starts the built Next.js web app, Hono API, worker, a loopback fake Meta Graph API, and an in-memory S3-compatible object store. CI supplies PostgreSQL and Valkey as service containers. Local `bun run test:e2e` starts the repository Postgres/Valkey compose services unless `E2E_MANAGE_INFRA=0` is set.

Server/worker fetch calls are preloaded with an E2E network guard: `graph.facebook.com` is rewritten to the loopback fake Meta server and every other non-loopback HTTP(S) fetch is rejected. Browser requests are guarded too; the only external-looking boundary intentionally fulfilled in-browser is the Facebook SDK URL used by Embedded Signup. No real WhatsApp messages, R2 objects, email provider calls, or customer infrastructure are contacted.

## Route coverage matrix

| Area | Routes | Coverage |
| --- | --- | --- |
| Public | `/`, `/features`, `/pricing`, `/whatsapp`, `/security`, `/contact`, `/privacy`, `/terms`, `/acceptable-use`, `/anti-spam` | Existing public/responsive suites: navigation/content, EN/LTR, AR/RTL, overflow |
| Auth/account | `/sign-up`, `/sign-in`, `/verify-email`, `/forgot-password`, `/reset-password`, `/two-factor`, `/account/security`, `/account-disabled`, `/workspace-suspended`, `/invite/[token]` | Full signup/verify/sign-in/out, password reset, real TOTP, invite acceptance, state redirects |
| Main app | `/dashboard`, `/contacts`, `/audiences`, `/templates`, `/campaigns`, `/campaigns/[id]`, `/reports`, `/reports/campaigns`, `/reports/templates`, `/reports/audiences`, `/reports/phone-numbers`, `/notifications`, `/onboarding` | Populated-owner route inventory plus deep workflows for contacts/audiences/templates/campaigns/reports/notifications; existing onboarding state suite retained |
| Settings | `/settings`, `/settings/general`, `/settings/team`, `/settings/whatsapp`, `/settings/security`, `/settings/billing`, `/settings/data`, `/settings/notifications` | Route inventory, persistence, invitations, fake Meta connection, notification toggles, export/retention/deletion controls |
| Platform admin | `/admin`, `/admin/organizations`, `/admin/organizations/[id]`, `/admin/users`, `/admin/campaigns`, `/admin/connections`, `/admin/imports`, `/admin/webhooks`, `/admin/system`, `/admin/audit` | Platform-admin-only route inventory plus plan/limit, suspend/reactivate, disable/re-enable mutations |

Repository route discovery found no additional concrete page routes outside this matrix. Public marketing content is implemented through the generic `(marketing)/[slug]` route and the listed slugs are the current concrete public pages.

## Interaction coverage matrix

| Interaction | Automated behavior |
| --- | --- |
| Buttons / links / navigation | Public navigation, sidebar routes, settings/admin navigation, invitation links, report export, destructive controls |
| Text/email/password fields | Signup/sign-in/reset, workspace settings, invitations, contact filters, audience/template/campaign inputs |
| Search / filters / selects | Contact search/status, audience filter builder, report date filter, campaign/template/phone selections, team roles |
| Checkboxes / toggles | Import consent, resubscribe consent, workspace deletion acknowledgement, notification preferences and mandatory disabled toggles |
| File uploads | CSV browser upload -> presign -> local S3 -> queue -> worker -> contacts |
| Confirmation dialogs | Campaign cancellation accepts the real browser confirmation dialog |
| Pagination | Notifications seed >20 rows and navigate to page 2 |
| Empty/populated states | Existing responsive suite covers empty product pages; functional suite seeds populated contacts/campaigns/reports/notifications/admin data |
| Validation errors | Reset-password mismatch, unverified sign-in, account-deletion ownership guard, destructive confirmation requirements |
| Persistence after reload | General settings, notification preferences, retention policy, onboarding state (existing suite) |
| Permission visibility | Owner/admin/member/viewer contact/team controls; anonymous protected redirects; platform-admin separation |
| Disabled/suspended state | Server-side account-disabled and workspace-suspended redirects |
| Browser health | Console/page errors, local request failures, local 5xx responses, unexpected external requests |
| Responsive/i18n/a11y basics | Existing desktop/tablet/mobile Chromium, EN/LTR + AR/RTL + overflow; role/name selectors used throughout new flows |

## End-to-end workflows

Automated functional coverage includes signup, email verification, sign-in/out, forgot/reset password, TOTP enrollment and second-factor login, onboarding (retained suite), workspace settings, team invitation/acceptance, contact import/search/filter/suppression/resubscribe, audience preview/save, template sync/create against fake Meta, Embedded Signup against fake SDK/Meta, campaign creation/launch/worker submission, pause/resume/cancel controls, campaign/report analytics rendering, report CSV export, notification preferences/read state/pagination, async contact export to local object storage, retention configuration, workspace deletion scheduling/cancellation, and platform-admin read/mutation paths.

## Role/state matrix

Covered states: anonymous, unverified account, verified owner, populated owner, admin, member, viewer, platform administrator, invited user, suspended workspace, disabled user/account. New-owner/onboarding state is retained in `e2e/onboarding.e2e.ts`.

## Known intentional gaps

- A successful permanent account deletion is not executed because a generated owner still owns its disposable workspace; the E2E suite verifies the ownership safety rejection instead. Workspace deletion scheduling and cancellation are exercised end-to-end.
- Real Meta, real R2, and a real email provider are deliberately not exercised. Their browser/server integration boundaries are replaced with local deterministic fakes or the existing capture-file email adapter.
- Delivery/read webhook progression remains covered by the webhook/security test suites rather than synthesizing Meta delivery webhooks inside the campaign browser workflow.
- Deep product interactions run once on desktop Chromium. Existing public/onboarding/i18n responsive smoke coverage continues on desktop/tablet/mobile Chromium to keep runtime bounded.

## Flake controls

No fixed multi-second sleeps were added. Tests wait on responses, URL/state assertions, the application’s own polling state, or bounded `expect.poll` checks. Screenshots are captured only on failure and traces are retained on failure. Functional tests use disposable organizations and clean them up in `finally` blocks.

## Execution

Run in order:

```sh
bun run test
bun run typecheck
bun run build
bun run test:e2e
```

Exact branch-CI results are recorded in the PR/branch summary after execution.
