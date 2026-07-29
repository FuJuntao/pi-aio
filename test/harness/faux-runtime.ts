/**
 * Offline model runtime for extension e2e tests.
 *
 * pi-ai's `fauxProvider` (scripted responses, no API keys, no network),
 * registered in its global api-registry so the ModelRuntime streams through it
 * (`streamSimple` -> `getApiProvider`). Shared by every extension e2e suite: a
 * test drives a turn with `session.prompt()` and the faux provider replies with
 * the scripted steps, so no real credentials or network are needed.
 */

import { join } from "node:path";

import {
  fauxAssistantMessage,
  registerFauxProvider,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Build an offline ModelRuntime driven by the faux provider. `responses`
 * defaults to a single "done" assistant message. Register the faux provider with
 * a throwaway key so it counts as configured and the model is available;
 * streaming still routes through the global faux api-registry.
 *
 * Returns the faux provider handle (for `setResponses` / `state` / `unregister`),
 * the model, and the ModelRuntime - the three pieces `createAgentSession` needs.
 */
export async function createFauxRuntime(agentDir: string, responses?: readonly FauxResponseStep[]) {
  const faux = registerFauxProvider({
    models: [{ id: "faux-1", name: "Faux", reasoning: false, input: ["text"] }],
  });
  faux.setResponses(responses ? [...responses] : [fauxAssistantMessage("done")]);
  // No-arg overload returns Model<string> (non-undefined); keep that type rather
  // than the widened `Model<string> | undefined` of the `(modelId)` overload.
  const model = faux.getModel();

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
  });
  modelRuntime.registerProvider(model.provider, {
    api: faux.api,
    apiKey: "faux-key",
    baseUrl: model.baseUrl ?? "http://localhost:0",
    models: faux.models.map((entry) => ({
      id: entry.id,
      name: entry.name ?? entry.id,
      api: entry.api,
      baseUrl: entry.baseUrl ?? "http://localhost:0",
      reasoning: entry.reasoning,
      input: entry.input,
      cost: entry.cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
    })),
  });
  await modelRuntime.setRuntimeApiKey(model.provider, "faux-key");

  return { faux, model, modelRuntime };
}
