import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    getToken: () => 'test-token',
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockSuccess(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

import {
  usePromptProfiles,
  useCreateProfile,
  useDeleteProfile,
  useDuplicateProfile,
  useSwitchProfile,
  useUpdateProfile,
  useImportPreview,
  useImportApply,
} from './use-prompt-profiles';

const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Default',
  description: 'Standard balanced prompts',
  isBuiltIn: true,
  prompts: {},
  createdAt: '2025-01-01T00:00:00',
  updatedAt: '2025-01-01T00:00:00',
};

const CUSTOM_PROFILE = {
  id: 'custom-1',
  name: 'My Custom',
  description: 'Custom profile',
  isBuiltIn: false,
  prompts: { chat_assistant: { systemPrompt: 'Custom prompt' } },
  createdAt: '2025-01-02T00:00:00',
  updatedAt: '2025-01-02T00:00:00',
};

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePromptProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches profiles list', async () => {
    mockGet.mockResolvedValue({
      profiles: [DEFAULT_PROFILE, CUSTOM_PROFILE],
      activeProfileId: 'default',
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePromptProfiles(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data!.profiles).toHaveLength(2);
    expect(result.current.data!.activeProfileId).toBe('default');
    expect(mockGet).toHaveBeenCalledWith('/api/prompt-profiles');
  });
});

describe('useCreateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a profile and shows success toast', async () => {
    mockPost.mockResolvedValue(CUSTOM_PROFILE);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useCreateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'My Custom',
        description: 'Custom profile',
        prompts: { chat_assistant: { systemPrompt: 'Custom prompt' } },
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/api/prompt-profiles', {
      name: 'My Custom',
      description: 'Custom profile',
      prompts: { chat_assistant: { systemPrompt: 'Custom prompt' } },
    });
    expect(mockSuccess).toHaveBeenCalledWith('Profile created', {
      description: '"My Custom" is ready to use.',
    });
  });

  it('shows error toast on failure', async () => {
    mockPost.mockRejectedValue(new Error('Name already exists'));

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useCreateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          name: 'Default',
          description: '',
          prompts: {},
        });
      });
    } catch {
      // Expected
    }

    expect(mockError).toHaveBeenCalledWith('Failed to create profile', {
      description: 'Name already exists',
    });
  });
});

describe('useDeleteProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a profile and shows success toast', async () => {
    mockDelete.mockResolvedValue({ success: true });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useDeleteProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'custom-1', name: 'My Custom' });
    });

    expect(mockDelete).toHaveBeenCalledWith('/api/prompt-profiles/custom-1');
    expect(mockSuccess).toHaveBeenCalledWith('Profile deleted', {
      description: '"My Custom" has been removed.',
    });
  });
});

describe('useDuplicateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('duplicates a profile', async () => {
    mockPost.mockResolvedValue({ ...CUSTOM_PROFILE, id: 'dup-1', name: 'Copy of Default' });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useDuplicateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ sourceId: 'default', name: 'Copy of Default' });
    });

    expect(mockPost).toHaveBeenCalledWith('/api/prompt-profiles/default/duplicate', {
      name: 'Copy of Default',
    });
    expect(mockSuccess).toHaveBeenCalledWith('Profile duplicated', {
      description: '"Copy of Default" created from copy.',
    });
  });
});

describe('useSwitchProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches active profile', async () => {
    mockPost.mockResolvedValue({ success: true, activeProfileId: 'security-audit' });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useSwitchProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'security-audit' });
    });

    expect(mockPost).toHaveBeenCalledWith('/api/prompt-profiles/switch', {
      id: 'security-audit',
    });
  });

  it('shows error toast on failure', async () => {
    mockPost.mockRejectedValue(new Error('Profile not found'));

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useSwitchProfile(), {
      wrapper: createWrapper(queryClient),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({ id: 'nonexistent' });
      });
    } catch {
      // Expected
    }

    expect(mockError).toHaveBeenCalledWith('Failed to switch profile', {
      description: 'Profile not found',
    });
  });
});

describe('useUpdateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates a profile', async () => {
    mockPut.mockResolvedValue({ ...CUSTOM_PROFILE, name: 'Updated Name' });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useUpdateProfile(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'custom-1', name: 'Updated Name' });
    });

    expect(mockPut).toHaveBeenCalledWith('/api/prompt-profiles/custom-1', {
      name: 'Updated Name',
    });
    expect(mockSuccess).toHaveBeenCalledWith('Profile updated', {
      description: '"Updated Name" saved.',
    });
  });
});

// ── Import Preview / Apply Tests ────────────────────────────────────

const VALID_IMPORT_DATA = {
  version: 1,
  exportedAt: '2026-02-08T14:30:00Z',
  exportedFrom: 'dashboard-prod-01',
  profile: 'Security Audit',
  features: {
    chat_assistant: { systemPrompt: 'Imported security prompt', model: 'llama3.2:70b', temperature: 0.3 },
  },
};

const MOCK_PREVIEW_RESPONSE = {
  valid: true,
  profile: 'Security Audit',
  exportedAt: '2026-02-08T14:30:00Z',
  exportedFrom: 'dashboard-prod-01',
  summary: { added: 0, modified: 1, unchanged: 0 },
  featureCount: 1,
  changes: {
    chat_assistant: {
      status: 'modified' as const,
      before: { systemPrompt: 'Original prompt' },
      after: { systemPrompt: 'Imported security prompt', model: 'llama3.2:70b', temperature: 0.3 },
      tokenDelta: 20,
    },
  },
};

describe('useImportPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts import data and returns preview', async () => {
    mockPost.mockResolvedValue(MOCK_PREVIEW_RESPONSE);

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useImportPreview(), {
      wrapper: createWrapper(queryClient),
    });

    let preview: typeof MOCK_PREVIEW_RESPONSE | undefined;
    await act(async () => {
      preview = await result.current.mutateAsync(VALID_IMPORT_DATA);
    });

    expect(mockPost).toHaveBeenCalledWith('/api/prompt-profiles/import/preview', VALID_IMPORT_DATA);
    expect(preview?.valid).toBe(true);
    expect(preview?.summary.modified).toBe(1);
  });

  it('shows error toast on validation failure', async () => {
    mockPost.mockRejectedValue(new Error('Invalid import file format'));

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useImportPreview(), {
      wrapper: createWrapper(queryClient),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync(VALID_IMPORT_DATA);
      });
    } catch {
      // Expected
    }

    expect(mockError).toHaveBeenCalledWith('Invalid import file', {
      description: 'Invalid import file format',
    });
  });
});

describe('useImportApply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies import and shows success toast', async () => {
    mockPost.mockResolvedValue({ success: true, profile: CUSTOM_PROFILE });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useImportApply(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(VALID_IMPORT_DATA);
    });

    expect(mockPost).toHaveBeenCalledWith('/api/prompt-profiles/import', VALID_IMPORT_DATA);
    expect(mockSuccess).toHaveBeenCalledWith('Prompts imported', {
      description: 'All changes applied to active profile.',
    });
  });

  it('shows error toast on failure', async () => {
    mockPost.mockRejectedValue(new Error('Failed to apply import'));

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useImportApply(), {
      wrapper: createWrapper(queryClient),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync(VALID_IMPORT_DATA);
      });
    } catch {
      // Expected
    }

    expect(mockError).toHaveBeenCalledWith('Failed to import prompts', {
      description: 'Failed to apply import',
    });
  });
});
