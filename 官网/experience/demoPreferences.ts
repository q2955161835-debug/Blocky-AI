import type { Resource } from '../../packages/language-schema/src/index';
import type { ReasoningEffort } from '../../packages/resource-registry/src/model-capabilities';
export type DemoMode = 'agent' | 'builder';
export type DemoModelChoice = { model: string; effort: ReasoningEffort };
export type DemoModelChoices = Record<DemoMode, DemoModelChoice>;
export const demoModels: Resource[] = ['deepseek-v4-pro', 'deepseek-v4-flash'].map(modelId => ({
  schemaVersion: 'blocky.resource/v1alpha1', resourceId: `demo-${modelId}`, kind: 'model',
  scope: 'project', displayName: `预设演示 · ${modelId}`, definition: { provider: 'xirang', modelId },
  capabilityRequirements: [], secretBindings: [],
}));
export const initialModelChoices: DemoModelChoices = {
  agent: { model: demoModels[0].resourceId, effort: 'none' },
  builder: { model: demoModels[0].resourceId, effort: 'none' },
};
export type DemoAppearance = { fontSize: number; font: string; codeFont: string };
export const initialAppearance: DemoAppearance = { fontSize: 13, font: '"Microsoft YaHei UI", "Segoe UI", sans-serif', codeFont: 'ui-monospace, Consolas, monospace' };
