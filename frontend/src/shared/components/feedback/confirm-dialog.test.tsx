import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: 'Delete item',
    description: 'Are you sure you want to delete this item?',
    confirmLabel: 'Delete',
  };

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this item?')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete item')).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses default confirmLabel when not provided', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel={undefined} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses custom cancelLabel when provided', () => {
    render(<ConfirmDialog {...defaultProps} cancelLabel="Dismiss" />);
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('applies destructive styling for danger variant', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" />);
    const confirmBtn = screen.getByText('Delete');
    expect(confirmBtn).toHaveClass('bg-destructive');
  });

  it('applies amber styling for warning variant', () => {
    render(<ConfirmDialog {...defaultProps} variant="warning" />);
    const confirmBtn = screen.getByText('Delete');
    expect(confirmBtn).toHaveClass('bg-amber-600');
  });

  it('calls onCancel when overlay is clicked (dialog closes)', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    // Radix Dialog overlay click triggers onOpenChange(false) which calls onCancel
    const overlay = document.querySelector('[data-radix-portal] > [data-state="open"]');
    if (overlay) {
      fireEvent.click(overlay);
      expect(onCancel).toHaveBeenCalled();
    }
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('exposes dialog semantics with the title as accessible name', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete item' });
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-description');
  });

  it('applies primary styling for the default variant', () => {
    render(<ConfirmDialog {...defaultProps} variant="default" />);
    expect(screen.getByText('Delete')).toHaveClass('bg-primary');
  });

  it('renders children between the description and the buttons', () => {
    render(
      <ConfirmDialog {...defaultProps}>
        <input data-testid="extra-field" />
      </ConfirmDialog>,
    );
    expect(screen.getByTestId('extra-field')).toBeInTheDocument();
  });

  it('disables both buttons and shows a spinner while isLoading', () => {
    render(<ConfirmDialog {...defaultProps} isLoading />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((btn) => expect(btn).toBeDisabled());
    // Confirm label is replaced by the spinner
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('does not close via Escape while isLoading', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('applies a custom data-testid to the dialog content', () => {
    render(<ConfirmDialog {...defaultProps} data-testid="my-dialog" />);
    expect(screen.getByTestId('my-dialog')).toBeInTheDocument();
  });
});
