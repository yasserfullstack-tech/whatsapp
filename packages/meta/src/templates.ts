export type TemplateBindingSource = "display_name" | "phone_e164" | "literal";
export type TemplateParameterType = "text" | "image" | "video" | "document" | "payload";
export type TemplateParameterComponent = "header" | "body" | "button";

export type TemplateParameterSlot = {
  key: string;
  component: TemplateParameterComponent;
  index: number;
  parameterType: TemplateParameterType;
  label: string;
  buttonIndex?: number;
  buttonSubType?: "url" | "quick_reply";
};

export type TemplateParameterBinding = {
  key?: string;
  index: number;
  component?: TemplateParameterComponent;
  parameterType?: TemplateParameterType;
  buttonIndex?: number;
  buttonSubType?: "url" | "quick_reply";
  source: TemplateBindingSource;
  value?: string;
  fallback?: string;
};

export type TemplateAnalysis = {
  supported: boolean;
  errors: string[];
  slots: TemplateParameterSlot[];
};

export type RenderedTemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters?: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: { link: string } }
    | { type: "video"; video: { link: string } }
    | { type: "document"; document: { link: string } }
    | { type: "payload"; payload: string }
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positionalVariables(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function validateSequentialVariables(indexes: number[], label: string, errors: string[]): void {
  for (let offset = 0; offset < indexes.length; offset += 1) {
    if (indexes[offset] !== offset + 1) {
      errors.push(`${label} variables must be sequential: {{1}}, {{2}}, {{3}}, ...`);
      return;
    }
  }
}

function textSlots(
  component: "header" | "body",
  text: string,
  errors: string[],
): TemplateParameterSlot[] {
  const indexes = positionalVariables(text);
  validateSequentialVariables(indexes, component === "header" ? "Header" : "Body", errors);
  return indexes.map((index) => ({
    key: `${component}:text:${index}`,
    component,
    index,
    parameterType: "text",
    label: `${component === "header" ? "Header" : "Body"} {{${index}}}`,
  }));
}

export function analyzeTemplateComponents(value: unknown): TemplateAnalysis {
  const errors: string[] = [];
  const slots: TemplateParameterSlot[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    return { supported: false, errors: ["Template components are missing"], slots: [] };
  }

  let bodyCount = 0;
  let headerCount = 0;
  let buttonsCount = 0;

  for (const raw of value) {
    if (!isRecord(raw)) {
      errors.push("Template contains an invalid component");
      continue;
    }
    const type = typeof raw.type === "string" ? raw.type.toUpperCase() : "";

    if (type === "BODY") {
      bodyCount += 1;
      if (typeof raw.text !== "string" || !raw.text.trim()) {
        errors.push("Template body text is required");
        continue;
      }
      slots.push(...textSlots("body", raw.text, errors));
      continue;
    }

    if (type === "FOOTER") {
      if (typeof raw.text !== "string") errors.push("Template footer text is invalid");
      continue;
    }

    if (type === "HEADER") {
      headerCount += 1;
      const format = typeof raw.format === "string" ? raw.format.toUpperCase() : "";
      if (format === "TEXT") {
        if (typeof raw.text !== "string" || !raw.text.trim()) errors.push("Text header content is required");
        else slots.push(...textSlots("header", raw.text, errors));
      } else if (format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT") {
        const parameterType = format.toLowerCase() as "image" | "video" | "document";
        slots.push({
          key: `header:${parameterType}:1`,
          component: "header",
          index: 1,
          parameterType,
          label: `${format[0]}${format.slice(1).toLowerCase()} header URL`,
        });
      } else {
        errors.push(`Unsupported header format: ${format || "unknown"}`);
      }
      continue;
    }

    if (type === "BUTTONS") {
      buttonsCount += 1;
      if (!Array.isArray(raw.buttons)) {
        errors.push("Template buttons are invalid");
        continue;
      }
      raw.buttons.forEach((buttonRaw, buttonIndex) => {
        if (!isRecord(buttonRaw)) {
          errors.push(`Button ${buttonIndex + 1} is invalid`);
          return;
        }
        const buttonType = typeof buttonRaw.type === "string" ? buttonRaw.type.toUpperCase() : "";
        if (buttonType === "PHONE_NUMBER") return;
        if (buttonType === "QUICK_REPLY") {
          slots.push({
            key: `button:${buttonIndex}:quick_reply:1`,
            component: "button",
            index: 1,
            parameterType: "payload",
            label: `Quick reply ${buttonIndex + 1} payload`,
            buttonIndex,
            buttonSubType: "quick_reply",
          });
          return;
        }
        if (buttonType === "URL") {
          const url = typeof buttonRaw.url === "string" ? buttonRaw.url : "";
          const indexes = positionalVariables(url);
          validateSequentialVariables(indexes, `URL button ${buttonIndex + 1}`, errors);
          for (const index of indexes) {
            slots.push({
              key: `button:${buttonIndex}:url:${index}`,
              component: "button",
              index,
              parameterType: "text",
              label: `URL button ${buttonIndex + 1} {{${index}}}`,
              buttonIndex,
              buttonSubType: "url",
            });
          }
          return;
        }
        errors.push(`Unsupported button type: ${buttonType || "unknown"}`);
      });
      continue;
    }

    errors.push(`Unsupported template component: ${type || "unknown"}`);
  }

  if (bodyCount !== 1) errors.push("Templates must contain exactly one body component");
  if (headerCount > 1) errors.push("Templates can contain at most one header component");
  if (buttonsCount > 1) errors.push("Templates can contain at most one buttons component");

  const keys = new Set<string>();
  for (const slot of slots) {
    if (keys.has(slot.key)) errors.push(`Duplicate template parameter slot: ${slot.key}`);
    keys.add(slot.key);
  }

  return { supported: errors.length === 0, errors, slots };
}

function bindingKey(binding: TemplateParameterBinding): string {
  if (binding.key?.trim()) return binding.key.trim();
  const component = binding.component ?? "body";
  const parameterType = binding.parameterType ?? "text";
  if (component === "button") {
    const subType = binding.buttonSubType ?? "url";
    return `button:${binding.buttonIndex ?? 0}:${subType}:${binding.index}`;
  }
  return `${component}:${parameterType}:${binding.index}`;
}

export function validateTemplateBindings(
  components: unknown,
  bindings: TemplateParameterBinding[],
): { valid: boolean; errors: string[]; normalizedBindings: TemplateParameterBinding[] } {
  const analysis = analyzeTemplateComponents(components);
  if (!analysis.supported) return { valid: false, errors: analysis.errors, normalizedBindings: [] };

  const errors: string[] = [];
  const byKey = new Map<string, TemplateParameterBinding>();
  for (const binding of bindings) {
    const key = bindingKey(binding);
    if (byKey.has(key)) errors.push(`Template parameter ${key} is mapped more than once`);
    byKey.set(key, { ...binding, key });
  }

  const required = new Set(analysis.slots.map((slot) => slot.key));
  for (const slot of analysis.slots) {
    const binding = byKey.get(slot.key);
    if (!binding) {
      errors.push(`${slot.label} is not mapped`);
      continue;
    }
    if (binding.source === "display_name" && !binding.fallback?.trim()) {
      errors.push(`${slot.label} needs an explicit contact-name fallback`);
    }
    if (binding.source === "literal" && !binding.value?.trim()) {
      errors.push(`${slot.label} needs a literal value`);
    }
    if ((slot.parameterType === "image" || slot.parameterType === "video" || slot.parameterType === "document") && binding.source !== "literal") {
      errors.push(`${slot.label} must use a fixed HTTPS media URL`);
    }
    if (slot.parameterType === "payload" && binding.source !== "literal") {
      errors.push(`${slot.label} must use a fixed payload`);
    }
  }
  for (const key of byKey.keys()) {
    if (!required.has(key)) errors.push(`Unexpected template parameter mapping: ${key}`);
  }

  const normalizedBindings = analysis.slots.flatMap((slot) => {
    const binding = byKey.get(slot.key);
    if (!binding) return [];
    return [{
      ...binding,
      key: slot.key,
      index: slot.index,
      component: slot.component,
      parameterType: slot.parameterType,
      ...(slot.buttonIndex === undefined ? {} : { buttonIndex: slot.buttonIndex }),
      ...(slot.buttonSubType === undefined ? {} : { buttonSubType: slot.buttonSubType }),
    } satisfies TemplateParameterBinding];
  });

  return { valid: errors.length === 0, errors, normalizedBindings };
}

function resolveBindingValue(
  binding: TemplateParameterBinding,
  recipient: { displayName: string | null; phoneE164: string },
): string {
  if (binding.source === "display_name") {
    const displayName = recipient.displayName?.trim();
    const fallback = binding.fallback?.trim();
    if (!displayName && !fallback) throw new Error(`${binding.key ?? "Template parameter"} has no contact-name value`);
    return displayName || fallback!;
  }
  if (binding.source === "phone_e164") return recipient.phoneE164;
  const value = binding.value?.trim();
  if (!value) throw new Error(`${binding.key ?? "Template parameter"} has no literal value`);
  return value;
}

function mediaParameter(type: "image" | "video" | "document", link: string) {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error(`${type} template header requires a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${type} template header requires a valid HTTPS URL`);
  if (type === "image") return { type, image: { link } } as const;
  if (type === "video") return { type, video: { link } } as const;
  return { type, document: { link } } as const;
}

export function renderTemplateComponents(
  components: unknown,
  bindings: TemplateParameterBinding[],
  recipient: { displayName: string | null; phoneE164: string },
): RenderedTemplateComponent[] | undefined {
  const validation = validateTemplateBindings(components, bindings);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  if (!validation.normalizedBindings.length) return undefined;

  const rendered: RenderedTemplateComponent[] = [];
  const header = validation.normalizedBindings.filter((binding) => binding.component === "header");
  if (header.length) {
    rendered.push({
      type: "header",
      parameters: header.map((binding) => {
        const value = resolveBindingValue(binding, recipient);
        const parameterType = binding.parameterType ?? "text";
        if (parameterType === "image" || parameterType === "video" || parameterType === "document") {
          return mediaParameter(parameterType, value);
        }
        return { type: "text" as const, text: value };
      }),
    });
  }

  const body = validation.normalizedBindings.filter((binding) => binding.component === "body");
  if (body.length) {
    rendered.push({
      type: "body",
      parameters: body.map((binding) => ({ type: "text" as const, text: resolveBindingValue(binding, recipient) })),
    });
  }

  for (const binding of validation.normalizedBindings.filter((item) => item.component === "button")) {
    const value = resolveBindingValue(binding, recipient);
    rendered.push({
      type: "button",
      sub_type: binding.buttonSubType ?? "url",
      index: String(binding.buttonIndex ?? 0),
      parameters: binding.parameterType === "payload"
        ? [{ type: "payload", payload: value }]
        : [{ type: "text", text: value }],
    });
  }

  return rendered;
}
