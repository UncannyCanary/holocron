import type Anthropic from '@anthropic-ai/sdk';

// The model client, injected so a test can hand the pipeline a recorded
// answer instead of paying for a real call.
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');

export type ModelClient = Anthropic;
