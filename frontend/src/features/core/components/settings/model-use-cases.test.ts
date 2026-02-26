import { describe, it, expect } from 'vitest';
import { getModelUseCase } from './model-use-cases';

describe('getModelUseCase (#645)', () => {
  it('returns Gold Standard for qwen3:32b', () => {
    expect(getModelUseCase('qwen3:32b')).toMatchObject({ label: 'Gold Standard' });
  });

  it('returns Deep Analysis for deepseek-r1:32b', () => {
    expect(getModelUseCase('deepseek-r1:32b')).toMatchObject({ label: 'Deep Analysis' });
  });

  it('returns Reasoning for deepseek-r1 (no size)', () => {
    expect(getModelUseCase('deepseek-r1')).toMatchObject({ label: 'Reasoning' });
  });

  it('returns Logic King for phi-4', () => {
    expect(getModelUseCase('phi-4')).toMatchObject({ label: 'Logic King' });
    expect(getModelUseCase('phi4')).toMatchObject({ label: 'Logic King' });
  });

  it('returns Log Specialist for mistral-nemo', () => {
    expect(getModelUseCase('mistral-nemo')).toMatchObject({ label: 'Log Specialist' });
  });

  it('returns Standard for llama3.2:8b', () => {
    expect(getModelUseCase('llama3.2:8b')).toMatchObject({ label: 'Standard' });
  });

  it('returns Lightweight for llama3.2:3b', () => {
    expect(getModelUseCase('llama3.2:3b')).toMatchObject({ label: 'Lightweight' });
  });

  it('returns Powerhouse for llama3.3:70b', () => {
    expect(getModelUseCase('llama3.3:70b')).toMatchObject({ label: 'Powerhouse' });
  });

  it('returns Efficient for gemma2:27b', () => {
    expect(getModelUseCase('gemma2:27b')).toMatchObject({ label: 'Efficient' });
  });

  it('returns Code Expert for codellama', () => {
    expect(getModelUseCase('codellama')).toMatchObject({ label: 'Code Expert' });
  });

  it('returns RAG Specialist for command-r', () => {
    expect(getModelUseCase('command-r')).toMatchObject({ label: 'RAG Specialist' });
  });

  it('returns Standard fallback for unknown models', () => {
    const result = getModelUseCase('some-unknown-model');
    expect(result.label).toBe('Standard');
    expect(result.description).toBe('General-purpose model');
  });

  it('returns Open GPT for gpt-oss:20b', () => {
    expect(getModelUseCase('gpt-oss:20b')).toMatchObject({ label: 'Open GPT' });
    expect(getModelUseCase('gpt-oss:20B')).toMatchObject({ label: 'Open GPT' });
  });

  it('is case-insensitive', () => {
    expect(getModelUseCase('Qwen3:32B')).toMatchObject({ label: 'Gold Standard' });
    expect(getModelUseCase('DEEPSEEK-R1:32B')).toMatchObject({ label: 'Deep Analysis' });
  });

  it('updates instantly (pure function, no side effects)', () => {
    const result1 = getModelUseCase('qwen3:32b');
    const result2 = getModelUseCase('deepseek-r1:32b');
    expect(result1.label).not.toBe(result2.label);
  });
});
