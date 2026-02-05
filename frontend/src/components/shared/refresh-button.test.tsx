import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefreshButton } from './refresh-button';

describe('RefreshButton', () => {
  it('should render button with Refresh text', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    expect(screen.getByRole('button')).toHaveTextContent('Refresh');
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when isLoading is true', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should not be disabled when isLoading is false', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={false} />);

    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
  });

  it('should not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('should apply spin animation to icon when loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={true} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');
  });

  it('should not apply spin animation when not loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={false} />);

    const icon = container.querySelector('svg');
    expect(icon).not.toHaveClass('animate-spin');
  });

  it('should apply custom className', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} className="custom-class" />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('should render with opacity when disabled', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('disabled:opacity-50');
  });

  it('should handle multiple clicks when not loading', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('should have proper base styling', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('inline-flex');
    expect(button).toHaveClass('items-center');
    expect(button).toHaveClass('rounded-md');
  });

  it('should contain RefreshCw icon', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('h-4');
    expect(icon).toHaveClass('w-4');
  });
});
