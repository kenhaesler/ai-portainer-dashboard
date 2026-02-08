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
