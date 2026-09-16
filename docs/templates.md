# WhatsApp message templates

Templates belong to a WhatsApp Business Account (WABA), not to an individual phone number. The application therefore stores `waba_id` on every local template and uses `(organization_id, waba_id, name, language)` as the natural uniqueness boundary.

## Sync

`POST /api/templates/sync` loads all message templates for one connected WABA (or every connected WABA when no ID is provided), follows Meta cursor pagination, and upserts the current status, category, components, rejection reason, and body preview into PostgreSQL.

Meta remains the source of truth for approval state. Local values are a cache used by the campaign builder and dashboard. The complete `components` array from Meta is stored as JSONB, so rich templates keep their structural header, body, footer, and button definitions during every sync.

## Supported rich template structure

PR-015 supports the following message-template components for local creation, preview, campaign mapping, and sending:

- `HEADER` with `TEXT`, `IMAGE`, `VIDEO`, or `DOCUMENT` format.
- `BODY` text with sequential positional variables such as `{{1}}`, `{{2}}`, and `{{3}}`.
- Optional `FOOTER` text.
- `BUTTONS` containing URL, phone-number, and quick-reply actions.
- Dynamic URL parameters and quick-reply payloads at campaign send time.

Media templates require the Meta media handle used as the header example when the template is submitted for review. When a campaign is launched, image/video/document headers require a fixed HTTPS media URL. Dynamic URL buttons and quick replies are represented as explicit campaign parameter slots rather than being flattened into body variables.

Authentication/OTP templates, catalog/product templates, location headers, Flows buttons, and other component families are intentionally not part of PR-015. They can still be imported and stored during Meta sync, but the campaign builder excludes them and the API/worker preflight rejects attempts to send them through this campaign path.

## Creation

`POST /api/templates` accepts the canonical structured `components` array produced by the template editor. The legacy body/footer request shape remains accepted for backward compatibility.

Before submitting to Meta, the API validates that:

- Exactly one body component exists.
- At most one header and one buttons component exist.
- Header and button types are in the supported set above.
- Text variables are positive and sequential within each component.
- Duplicate parameter slots are rejected.

The browser editor collects Meta review examples for body/header variables, media header handles, and dynamic URL buttons. Template names remain lowercase letters, numbers, and underscores.

## Campaign parameter mapping

The campaign builder derives stable slots from the stored Meta component structure. Examples include:

- `header:text:1`
- `header:image:1`
- `body:text:1`
- `button:0:url:1`
- `button:1:quick_reply:1`

Text slots can map to contact display name, contact phone, or a fixed literal. Display-name mappings require an explicit fallback. Media and quick-reply payload slots are fixed values; media values must be HTTPS URLs.

Validation happens twice: once when the campaign is created and again in the worker immediately before the recipient snapshot/send queue is produced. The worker then renders Meta's component parameter shape for each recipient. Legacy body-only campaign bindings are normalized to `body:text:N` so existing records keep working.

## Template preview

The template library and campaign builder render the structural template rather than only `body_preview`. Text headers, media placeholders, body, footer, and button labels/actions are shown before a campaign is launched.

## Meta references

The implementation follows Meta's published WhatsApp Business Platform request examples:

- Image header + body/footer + call-to-action buttons: https://www.postman.com/meta/whatsapp-business-platform/request/n3jhmr4/create-template-w-image-header-text-body-text-footer-and-2-call-to-action-buttons
- Text header + quick-reply buttons: https://www.postman.com/meta/whatsapp-business-platform/request/uvx80vi/create-template-w-text-header-text-body-text-footer-and-2-quick-reply-buttons
- Document header + phone and URL buttons: https://www.postman.com/meta/whatsapp-business-platform/request/ep5w4rc/create-template-w-document-header-text-body-a-phone-number-button-and-a-url-button
- Cloud API template send examples, including media headers and quick-reply payloads: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

## Credentials

Template requests decrypt the same per-client credential captured during Embedded Signup. Access tokens are never sent to the browser. WABA access is always checked against the authenticated organization before the Meta request is made.

## Release evidence

The automated suite covers text headers, image/video/document headers, dynamic URL buttons, phone buttons, quick-reply payloads, legacy body bindings, missing mappings, non-HTTPS media, and unsupported component combinations.

Before closing PR-015, staging still needs redacted Meta evidence for at least one approved rich template and a real send showing the expected supported components. Keep `docs/production-readiness-plan.md` unchecked until that external validation is attached to issue #60 or the implementation PR.
