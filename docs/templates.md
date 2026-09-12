# WhatsApp message templates

Templates belong to a WhatsApp Business Account (WABA), not to an individual phone number. The application therefore stores `waba_id` on every local template and uses `(organization_id, waba_id, name, language)` as the natural uniqueness boundary.

## Sync

`POST /api/templates/sync` loads all message templates for one connected WABA (or every connected WABA when no ID is provided), follows Meta cursor pagination, and upserts the current status, category, components, rejection reason, and body preview into PostgreSQL.

Meta remains the source of truth for approval state. Local values are a cache used by the campaign builder and dashboard.

## Creation

`POST /api/templates` submits a new text template to Meta. The first implementation supports:

- Marketing and utility categories.
- Text BODY up to 1024 characters.
- Optional FOOTER up to 60 characters.
- Positional variables such as `{{1}}`, `{{2}}`, and `{{3}}`.
- One example value per positional variable for Meta review.

Template names are lowercase letters, numbers, and underscores. Variables must be sequential with no gaps.

Existing templates with headers, media, and buttons still sync because their complete Meta `components` payload is stored as JSON. Creation of those richer component types can be added without changing the storage model.

## Credentials

Template requests decrypt the same per-client credential captured during Embedded Signup. Access tokens are never sent to the browser. WABA access is always checked against the authenticated organization before the Meta request is made.
