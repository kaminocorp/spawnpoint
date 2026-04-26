import { ModelProvider } from "@/gen/corellia/v1/agents_pb";

export function providerLabel(p: ModelProvider): string {
  switch (p) {
    case ModelProvider.ANTHROPIC:
      return "anthropic";
    case ModelProvider.OPENAI:
      return "openai";
    case ModelProvider.OPENROUTER:
      return "openrouter";
    default:
      return "—";
  }
}

export function formatCreated(rfc3339: string): string {
  if (!rfc3339) return "—";
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
