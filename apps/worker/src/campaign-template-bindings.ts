import type { TemplateParameterBinding } from "@wa/meta/templates";

export function normalizeBindings(value: unknown): TemplateParameterBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is TemplateParameterBinding => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<TemplateParameterBinding>;
      return typeof candidate.index === "number" &&
        (candidate.source === "display_name" || candidate.source === "phone_e164" || candidate.source === "literal");
    })
    .sort((a, b) => a.index - b.index);
}

export function richBindingConfigurationError(bindings: TemplateParameterBinding[]): string | null {
  for (const binding of bindings) {
    if (binding.source === "display_name" && !binding.fallback?.trim()) {
      return `${binding.key ?? `Template variable {{${binding.index}}}`} needs an explicit contact-name fallback`;
    }
    if (binding.source === "literal" && !binding.value?.trim()) {
      return `${binding.key ?? `Template variable {{${binding.index}}}`} needs a literal value`;
    }
    if (binding.parameterType === "image" || binding.parameterType === "video" || binding.parameterType === "document") {
      const value = binding.value?.trim();
      if (!value) return `${binding.key ?? "Media header"} needs a media URL`;
      try {
        if (new URL(value).protocol !== "https:") return `${binding.key ?? "Media header"} needs an HTTPS media URL`;
      } catch {
        return `${binding.key ?? "Media header"} needs a valid HTTPS media URL`;
      }
    }
  }
  return null;
}
