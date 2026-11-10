export const localGrokMode = import.meta.env.VITE_CAFE_LOCAL_GROK === "1";

export const localGrokModels = [{
  engine: "ai-sdk:openai",
  label: "Grok",
  models: ["grok-4.5"],
  modelDisplayNames: { "grok-4.5": "Grok 4.5 · High" },
  configured: true,
}];

export const localGrokComposerProps = localGrokMode ? {
  availableModels: localGrokModels,
  modelListLoading: false,
  selectedModel: "grok-4.5",
  selectedEngine: "ai-sdk:openai",
} : {};
