import { describe, expect, it } from 'vitest';
import { reasoningInputs, thinkingRoom } from '../src/ai.js';

describe('reasoningInputs', () => {
  it('switches on/off families on and off', () => {
    expect(reasoningInputs('@cf/zai-org/glm-4.7-flash', 'off')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(reasoningInputs('@cf/zai-org/glm-4.7-flash', 'low')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(reasoningInputs('@cf/google/gemma-4-26b-a4b-it', 'high')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
  });

  it('maps levels for families with an effort setting', () => {
    expect(reasoningInputs('@cf/deepseek-ai/deepseek-v4-flash-0731', 'off')).toEqual({ reasoning_effort: 'none' });
    expect(reasoningInputs('@cf/deepseek-ai/deepseek-v4-flash-0731', 'high')).toEqual({ reasoning_effort: 'max' });
    expect(reasoningInputs('@cf/nvidia/nemotron-3-120b-a12b', 'low')).toEqual({ chat_template_kwargs: { enable_thinking: true, low_effort: true } });
  });

  it('never stops GLM-5 thinking (it cannot), and gives it room even at off', () => {
    expect(reasoningInputs('@cf/zai-org/glm-5.3-flash', 'off')).toEqual({ reasoning_effort: 'low' });
    expect(thinkingRoom('@cf/zai-org/glm-5.3-flash', 'off')).toBeGreaterThan(0);
  });

  it('sends nothing to families whose switch is not confirmed', () => {
    for (const model of ['@cf/openai/gpt-oss-120b', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']) {
      expect(reasoningInputs(model, 'off')).toEqual({});
    }
    expect(thinkingRoom('@cf/zai-org/glm-4.7-flash', 'off')).toBe(0);
  });
});
