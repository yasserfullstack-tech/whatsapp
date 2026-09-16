# UI comparison: `main` vs `feat/ui-skills-guided-ui`

## Scope

This comparison is intentionally limited to the changes introduced by `feat/ui-skills-guided-ui`. The experiment preserves the current application identity and does not attempt a redesign or framework migration.

Compared surfaces:

- shared product design guidance
- keyboard focus treatment
- dashboard WhatsApp empty state
- account deletion confirmation
- English/Arabic parity for the new destructive flow

## What remains the same

Both versions retain the current application identity:

- dark green authenticated navigation
- neutral page and panel surfaces
- one primary green action accent
- existing panel/card/radius hierarchy
- current typography stack
- existing responsive shell and mobile horizontal navigation
- existing RTL behavior
- existing domain workflows and permissions

The experiment therefore tests whether a stricter UI contract and a few targeted interaction improvements help the product, rather than whether a different visual style is preferable.

## Comparison

| Area | `main` | `feat/ui-skills-guided-ui` | Better fit |
| --- | --- | --- | --- |
| Product identity | Established and coherent | Preserved unchanged | Tie |
| Design-system consistency | Mostly implicit in CSS/components | Existing rules documented in `apps/web/DESIGN.md` | Guided branch |
| Keyboard focus | Form-specific focus exists, but no consistent global keyboard treatment | Shared `:focus-visible` treatment for links, buttons and form controls | Guided branch |
| Dashboard empty state | Explains missing WhatsApp number but local empty state has no next action | Adds an authorized CTA to the existing WhatsApp settings flow | Guided branch |
| Account deletion safety | Typed `DELETE ACCOUNT` confirmation then direct irreversible request | Keeps typed confirmation and adds a final semantic modal confirmation | Guided branch |
| Failed destructive action | Error is shown in the settings surface | Error is shown and the confirmation dialog remains open | Guided branch |
| Arabic parity | Existing app supports Arabic/RTL | New confirmation copy is provided in English and Arabic | Tie / guided branch for new flow |
| Implementation churn | Lowest | Small: three new files and three modified product files before this comparison note | `main` for minimalism |
| Framework/dependency risk | None | No framework migration and no new runtime dependency | Tie |

## Findings

### 1. The guided branch is a better product fit than a UI Skills visual transplant

The strongest result is that the useful part of UI Skills is its discipline, not its own visual identity. The branch preserves the existing WhatsApp SaaS look and adds a documented contract around the patterns already in production.

### 2. The destructive flow is materially safer

Permanent account deletion is irreversible. The guided branch keeps the existing typed confirmation and requires a final modal decision. The modal uses a native `dialog`, moves focus to the cancel action, restores focus to the trigger on close, and remains open if the server rejects deletion.

This is a meaningful improvement without changing backend behavior.

### 3. The empty-state CTA removes unnecessary navigation work

When no phone number exists, the dashboard already explains the problem. The guided branch adds a direct action to `/settings/whatsapp` for users with `whatsapp.manage` permission. This makes the local empty state actionable without exposing actions to unauthorized roles.

### 4. The design contract should survive even if individual UI changes are adjusted

`apps/web/DESIGN.md` captures the current shared visual and interaction rules. Keeping that file reduces future drift across dashboard, contacts, campaigns, reports, settings, onboarding and admin work.

## Recommendation

Use `feat/ui-skills-guided-ui` as the better foundation for the app, while continuing to preserve the current visual identity.

Do **not** migrate the app to UI Skills' Tailwind assumptions or copy the UI Skills website aesthetic. The useful approach is:

1. keep the current design language;
2. retain `apps/web/DESIGN.md` as the product UI contract;
3. retain consistent `:focus-visible` behavior;
4. retain contextual actions in empty states;
5. retain layered confirmation for irreversible operations;
6. apply the same evidence-based review incrementally to other high-value product surfaces.

## Validation limitation

This comparison is source-level. The branch currently has no GitHub Actions run for build/typecheck, and this review did not have a deployed browser instance of both refs for screenshot comparison. Before merge, run the web typecheck/build and browser E2E suite, then visually compare desktop/mobile English and Arabic for the affected routes.
