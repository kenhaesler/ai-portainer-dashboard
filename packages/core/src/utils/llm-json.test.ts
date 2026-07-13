import { describe, it, expect } from 'vitest';
import { extractLlmJson } from './llm-json.js';

describe('extractLlmJson', () => {
  it('parses bare JSON', () => {
    expect(extractLlmJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractLlmJson('  {"a":1}  ')).toEqual({ a: 1 });
  });

  it('parses JSON inside a ```json fenced block', () => {
    const raw = '```json\n{"root_cause":"disk full"}\n```';
    expect(extractLlmJson(raw)).toEqual({ root_cause: 'disk full' });
  });

  it('parses JSON inside a bare ``` fence', () => {
    expect(extractLlmJson('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('tolerates leading and trailing prose around the fence', () => {
    const raw = 'Here is the analysis:\n```json\n{"severity":"critical"}\n```\nHope that helps!';
    expect(extractLlmJson(raw)).toEqual({ severity: 'critical' });
  });

  it('accepts an uppercase JSON language tag (case-insensitive)', () => {
    // This is the cross-feature consistency the previous case-sensitive copies lacked (#1512).
    expect(extractLlmJson('```JSON\n{"x":1}\n```')).toEqual({ x: 1 });
  });

  it('returns null for non-JSON / unparseable input', () => {
    expect(extractLlmJson('just some prose with no json')).toBeNull();
    expect(extractLlmJson('')).toBeNull();
    expect(extractLlmJson('```json\nnot valid json\n```')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(extractLlmJson(undefined as unknown as string)).toBeNull();
    expect(extractLlmJson(null as unknown as string)).toBeNull();
  });

  it('surfaces the typed shape via the generic parameter', () => {
    const parsed = extractLlmJson<{ tool_calls: string[] }>('{"tool_calls":["a","b"]}');
    expect(parsed?.tool_calls).toEqual(['a', 'b']);
  });
});
