---
version: alpha
name: WhatsApp Campaigns Web
description: Existing product design language for the customer, authentication, settings, reporting, and platform-admin web surfaces.
colors:
  background: "#f5f7f8"
  surface: "#ffffff"
  surface-2: "#f0f4f2"
  text: "#17211d"
  muted: "#68756e"
  line: "#e2e8e5"
  accent: "#0d8f5d"
  accent-dark: "#08754b"
  accent-soft: "#e9f8f1"
  warning: "#9f6512"
  warning-soft: "#fff6dc"
  danger: "#a33a3a"
  danger-soft: "#fff0f0"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
---

## Overview

The web application uses a restrained SaaS interface centered on WhatsApp campaign operations. Preserve the existing dark-green application navigation, neutral content surfaces, single green action accent, compact status treatments, and bilingual English/Arabic behavior rather than replacing them with a new visual identity.

## Colors

- Use the shared CSS color roles from `app/globals.css` for new customer-facing interface work instead of introducing page-local brand colors.
- Keep green as the primary action and positive-status accent within a view; use warning and danger roles only for their corresponding states.
- Use neutral surfaces and borders for containers, dense operational rows, settings, and reporting UI.

## Typography

- Use the existing sans-serif interface stack for product copy and controls.
- Preserve the established heading hierarchy from the global styles instead of introducing route-specific display typography.
- Use localized text direction and the existing RTL font fallback supplied by `app/responsive.css` for Arabic.

## Layout

- Use the shared `.shell`, `.sidebar`, and `.content` composition for authenticated product surfaces.
- Reuse `.panel`, `.connectionCard`, `.statCard`, and existing settings/reporting surface classes before creating new container treatments.
- On narrow screens, preserve the sticky horizontally scrollable primary navigation defined in `app/responsive.css`.
- Keep action placement close to the state it resolves. Empty states should expose one clear authorized next action when the user can perform it.

## Elevation & Depth

- Use the shared surface border and `--shadow` treatment for elevated product cards and panels.
- Keep depth subtle. New glow effects or competing decorative elevation should not become primary affordances.

## Shapes

- Reuse the existing restrained rounded treatment for cards, controls, status pills, and dialogs.
- Keep dense operational rows visually simpler than primary cards so hierarchy remains clear.

## Components

- Reuse existing application components and route-local patterns before adding a new primitive.
- Use native semantic controls for basic interactions. For modal destructive confirmation, use a real dialog surface with visible focus, Escape-to-close behavior, focus restoration, and an explicit cancel action.
- Keep destructive confirmation layered: typed confirmation or acknowledgement where already required, followed by a final modal confirmation only for irreversible actions.
- Place validation or action errors beside the surface that initiated them and preserve `role="alert"` or `role="status"` where the current interaction requires announcement.

## Do's and Don'ts

- Do preserve English/Arabic parity and RTL behavior when changing shared UI.
- Do provide visible keyboard focus for interactive controls.
- Do keep irreversible actions visually distinct and require an explicit final confirmation.
- Do reuse existing tokens and component owners instead of creating a second styling system.
- Don't migrate the application to a different CSS framework merely to satisfy an external UI playbook.
- Don't replace the current product identity with the visual style of the UI Skills reference repository.
