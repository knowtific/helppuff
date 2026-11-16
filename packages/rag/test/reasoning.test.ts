import { describe, expect, it } from 'vitest';
import { reasoningInputs, thinkingRoom } from '../src/ai.js';

describe('reasoningInputs', () => {
  it('switches on/off families on and off', () => {
    expect(reasoningInputs('@cf/zai-org/glm-4.7-flash', 'off')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(reasoningInputs('@cf/zai-org/glm-4.7-flash', 'low')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(reasoningInputs('@cf/google/gemma-4-26b-a4b-it', 'high')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
  });

  it('maps levels for families with an effort setting', () => {
    expect(reasoningInputs('@cf/deepseek-ai/deepseek-v4.1-flash-1017', 'off')).toEqual({ reasoning_effort: 'none' });
    expect(reasoningInputs('@cf/deepseek-ai/deepseek-v4.1-flash-1017', 'medium')).toEqual({ reasoning_effort: 'high' });
    expect(reasoningInputs('@cf/deepseek-ai/deepseek-v4.1-flash-1017', 'high')).toEqual({ reasoning_effort: 'max' });
  });

  it('never stops GLM-5 thinking (it cannot), and gives it room even at off', () => {
    expect(reasoningInputs('@cf/zai-org/glm-5.3', 'off')).toEqual({ reasoning_effort: 'low' });
    expect(thinkingRoom('@cf/zai-org/glm-5.3', 'off')).toBeGreaterThan(0);
  });

  it('sends nothing to families whose switch is not confirmed', () => {
    for (const model of ['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3.8-27b', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']) {
      expect(reasoningInputs(model, 'off')).toEqual({});
    }
    expect(thinkingRoom('@cf/zai-org/glm-4.7-flash', 'off')).toBe(0);
  });
});
