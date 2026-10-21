import type { EffortLevel, ModelCatalog, ModelSelection, ProviderSnapshot } from "./contracts.ts";
import { DEFAULT_AGENT_EFFORT, DEFAULT_CODEX_MODEL } from "./drivers/codex-catalog.ts";

interface SelectableInstance {
  instanceId: string;
  driverKind: string;
  snapshot: ProviderSnapshot;
  models: ModelCatalog;
  capabilities?: { effortLevels?: readonly EffortLevel[]; modelVariants?: boolean };
}

function supportsModel(instance: SelectableInstance, model: string): boolean {
  return instance.models.default === model || instance.models.options.some((option) => option.id === model);
}

function defaultSelectionFor(instance: SelectableInstance, model: string): ModelSelection {
  const selection: ModelSelection = { instanceId: instance.instanceId, model };
  if (instance.capabilities?.effortLevels?.includes(DEFAULT_AGENT_EFFORT)) {
    selection.effort = DEFAULT_AGENT_EFFORT;
  }
  return selection;
}

/** A saved choice is intentional: an unavailable provider or removed model
 * sends new bots to setup instead of silently changing their provider. */
export function selectDefaultModelSelection(
  instances: readonly SelectableInstance[],
  preferred?: ModelSelection,
): ModelSelection {
  if (preferred) {
    const instance = instances.find((candidate) => candidate.instanceId === preferred.instanceId);
    if (
      instance?.snapshot.state !== "available" ||
      instance.snapshot.authenticated === false ||
      (preferred.variant !== undefined && !instance.capabilities?.modelVariants) ||
      !(instance.models.default === preferred.model || instance.models.options.some((model) => model.id === preferred.model))
    ) {
      return { instanceId: "", model: "" };
    }
    const selection = { ...preferred };
    // A saved effort can outlive driver support. Keep the intentional model,
    // but let the provider use its own effort default instead of failing turn 1.
    if (selection.effort && !instance.capabilities?.effortLevels?.includes(selection.effort)) delete selection.effort;
    return selection;
  }
  const available = instances.filter((instance) => instance.snapshot.state === "available");
  // New bots and new room participants should use the same OpenAI profile as
  // OpenClaw by default. Prefer Luna even when another provider advertises a
  // provider-side default. Fall back to that provider's default only when the
  // installed catalog does not expose Luna, preserving setup compatibility.
  const codex = available.filter((instance) => instance.driverKind === "codex");
  const luna = codex.find((instance) => supportsModel(instance, DEFAULT_CODEX_MODEL));
  if (luna) return defaultSelectionFor(luna, DEFAULT_CODEX_MODEL);
  const codexFallback = codex[0];
  if (codexFallback) return defaultSelectionFor(codexFallback, codexFallback.models.default);
  const pick = available.find((instance) => instance.driverKind === "claudeAgent") ?? available[0];
  return pick ? defaultSelectionFor(pick, pick.models.default) : { instanceId: "", model: "" };
}
