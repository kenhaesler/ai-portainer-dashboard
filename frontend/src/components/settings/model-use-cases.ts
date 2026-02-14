/** Model use-case mapping: regex pattern → { label, description, color } */
export interface ModelUseCase {
  label: string;
  description: string;
  color: string; // Tailwind text color class
}

const MODEL_USE_CASES: Array<{
  pattern: RegExp;
  label: string;
  description: string;
  color: string;
}> = [
  { pattern: /qwen3[:-]32b/i, label: 'Gold Standard', description: 'Best for tool-calling, JSON accuracy, and structured output', color: 'text-yellow-500' },
  { pattern: /qwen3[:-](?:14|8)b/i, label: 'Balanced', description: 'Good all-round model for chat and analysis', color: 'text-blue-400' },
  { pattern: /qwen3[:-](?:4|1\.?7)b/i, label: 'Fast', description: 'Quick responses for general chat, lower resource use', color: 'text-green-400' },
  { pattern: /qwen2\.?5[:-](?:32|72)b/i, label: 'Tool Calling', description: 'Strong tool-calling and structured output', color: 'text-yellow-500' },
  { pattern: /deepseek-r1[:-](?:32|70)b/i, label: 'Deep Analysis', description: 'Best for complex root cause investigation and reasoning', color: 'text-purple-400' },
  { pattern: /deepseek-r1/i, label: 'Reasoning', description: 'Chain-of-thought reasoning for investigation tasks', color: 'text-purple-400' },
  { pattern: /phi-?4/i, label: 'Logic King', description: 'High reasoning capability for technical remediation', color: 'text-cyan-400' },
  { pattern: /mistral-nemo/i, label: 'Log Specialist', description: 'Excels at parsing long container logs (128k context)', color: 'text-orange-400' },
  { pattern: /mistral[:-](?:large|medium)/i, label: 'Enterprise', description: 'Strong general-purpose model for complex tasks', color: 'text-orange-400' },
  { pattern: /mistral/i, label: 'Versatile', description: 'Good general-purpose model for chat and analysis', color: 'text-orange-400' },
  { pattern: /codellama|code-?llama/i, label: 'Code Expert', description: 'Optimized for code generation and analysis', color: 'text-indigo-400' },
  { pattern: /llama3\.?3[:-]70b/i, label: 'Powerhouse', description: 'High-quality analysis and generation (requires 48GB+ VRAM)', color: 'text-blue-500' },
  { pattern: /llama3\.?[23][:-](?:8|11)b/i, label: 'Standard', description: 'Solid default for general chat and monitoring insights', color: 'text-blue-400' },
  { pattern: /llama3\.?[23][:-](?:1|3)b/i, label: 'Lightweight', description: 'Fast responses, low resource use, good for basic chat', color: 'text-green-400' },
  { pattern: /llama/i, label: 'General', description: 'General-purpose Meta Llama model', color: 'text-blue-400' },
  { pattern: /gemma[:-]?2[:-](?:27|9)b/i, label: 'Efficient', description: 'Google model — strong reasoning with good efficiency', color: 'text-emerald-400' },
  { pattern: /gemma/i, label: 'Compact', description: 'Google model — efficient for lighter workloads', color: 'text-emerald-400' },
  { pattern: /wizard-?coder|code/i, label: 'Code', description: 'Optimized for code-related tasks', color: 'text-indigo-400' },
  { pattern: /command-r/i, label: 'RAG Specialist', description: 'Cohere model — strong at retrieval-augmented generation', color: 'text-teal-400' },
];

const FALLBACK: ModelUseCase = { label: 'Standard', description: 'General-purpose model', color: 'text-muted-foreground' };

/** Human-readable reference table for the UI */
export const MODEL_USE_CASE_TABLE: Array<{ models: string; label: string; description: string; color: string }> = [
  { models: 'qwen3:32b', label: 'Gold Standard', description: 'Best for tool-calling, JSON accuracy, and structured output', color: 'text-yellow-500' },
  { models: 'qwen3:14b / 8b', label: 'Balanced', description: 'Good all-round model for chat and analysis', color: 'text-blue-400' },
  { models: 'qwen3:4b / 1.7b', label: 'Fast', description: 'Quick responses for general chat, lower resource use', color: 'text-green-400' },
  { models: 'qwen2.5:32b / 72b', label: 'Tool Calling', description: 'Strong tool-calling and structured output', color: 'text-yellow-500' },
  { models: 'deepseek-r1:32b / 70b', label: 'Deep Analysis', description: 'Best for complex root cause investigation and reasoning', color: 'text-purple-400' },
  { models: 'deepseek-r1', label: 'Reasoning', description: 'Chain-of-thought reasoning for investigation tasks', color: 'text-purple-400' },
  { models: 'phi-4', label: 'Logic King', description: 'High reasoning capability for technical remediation', color: 'text-cyan-400' },
  { models: 'mistral-nemo', label: 'Log Specialist', description: 'Excels at parsing long container logs (128k context)', color: 'text-orange-400' },
  { models: 'mistral:large / medium', label: 'Enterprise', description: 'Strong general-purpose model for complex tasks', color: 'text-orange-400' },
  { models: 'mistral', label: 'Versatile', description: 'Good general-purpose model for chat and analysis', color: 'text-orange-400' },
  { models: 'codellama', label: 'Code Expert', description: 'Optimized for code generation and analysis', color: 'text-indigo-400' },
  { models: 'llama3.3:70b', label: 'Powerhouse', description: 'High-quality analysis and generation (requires 48GB+ VRAM)', color: 'text-blue-500' },
  { models: 'llama3.2:8b / 11b', label: 'Standard', description: 'Solid default for general chat and monitoring insights', color: 'text-blue-400' },
  { models: 'llama3.2:1b / 3b', label: 'Lightweight', description: 'Fast responses, low resource use, good for basic chat', color: 'text-green-400' },
  { models: 'llama (other)', label: 'General', description: 'General-purpose Meta Llama model', color: 'text-blue-400' },
  { models: 'gemma2:27b / 9b', label: 'Efficient', description: 'Google model — strong reasoning with good efficiency', color: 'text-emerald-400' },
  { models: 'gemma', label: 'Compact', description: 'Google model — efficient for lighter workloads', color: 'text-emerald-400' },
  { models: 'wizard-coder / code', label: 'Code', description: 'Optimized for code-related tasks', color: 'text-indigo-400' },
  { models: 'command-r', label: 'RAG Specialist', description: 'Cohere model — strong at retrieval-augmented generation', color: 'text-teal-400' },
];

export function getModelUseCase(modelName: string): ModelUseCase {
  for (const entry of MODEL_USE_CASES) {
    if (entry.pattern.test(modelName)) {
      return { label: entry.label, description: entry.description, color: entry.color };
    }
  }
  return FALLBACK;
}
