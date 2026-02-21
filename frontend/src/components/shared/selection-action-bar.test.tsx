import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SelectionActionBar } from './selection-action-bar';

describe('SelectionActionBar', () => {
  it('renders when visible is true', () => {
    render(
      <SelectionActionBar selectedCount={3} visible={true} onClear={vi.fn()}>
        <button>Compare</button>
      </SelectionActionBar>,
    );

    expect(screen.getByTestId('selection-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('selection-count')).toHaveTextContent('3');
    expect(screen.getByText('selected')).toBeInTheDocument();
    expect(screen.getByText('Compare')).toBeInTheDocument();
  });

  it('does not render when visible is false', () => {
    render(
      <SelectionActionBar selectedCount={0} visible={false} onClear={vi.fn()}>
        <button>Compare</button>
      </SelectionActionBar>,
    );

    expect(screen.queryByTestId('selection-action-bar')).not.toBeInTheDocument();
  });

  it('calls onClear when clear button is clicked', () => {
    const onClear = vi.fn();
    render(
      <SelectionActionBar selectedCount={2} visible={true} onClear={onClear}>
        <button>Compare</button>
      </SelectionActionBar>,
    );

    fireEvent.click(screen.getByTestId('clear-selection'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('displays the correct selection count', () => {
    render(
      <SelectionActionBar selectedCount={4} visible={true} onClear={vi.fn()}>
        <button>Compare</button>
      </SelectionActionBar>,
    );

    expect(screen.getByTestId('selection-count')).toHaveTextContent('4');
  });

  it('renders children as action buttons', () => {
    render(
      <SelectionActionBar selectedCount={2} visible={true} onClear={vi.fn()}>
        <button data-testid="action-1">Action 1</button>
        <button data-testid="action-2">Action 2</button>
      </SelectionActionBar>,
    );

    expect(screen.getByTestId('action-1')).toBeInTheDocument();
    expect(screen.getByTestId('action-2')).toBeInTheDocument();
  });
});
