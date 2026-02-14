import { render, screen } from '@testing-library/react';
import { PostLoginLoading } from './post-login-loading';
import { describe, it, expect } from 'vitest';

// Mock framer-motion to avoid animation issues in tests
import { vi } from 'vitest';
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('PostLoginLoading', () => {
  it('renders the loading text', () => {
    render(<PostLoginLoading />);
    expect(screen.getByText('Initializing Intelligence')).toBeDefined();
    expect(screen.getByText('Powered by AI')).toBeDefined();
  });

  it('renders the logo', () => {
    render(<PostLoginLoading />);
    expect(screen.getByRole('img', { name: /loading logo/i })).toBeDefined();
  });
});
