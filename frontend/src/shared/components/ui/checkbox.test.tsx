import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('renders a native input wrapped in a themed span', () => {
    render(<Checkbox data-testid="cb" aria-label="row" />);
    const input = screen.getByTestId('cb');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('type')).toBe('checkbox');
    const wrapper = input.parentElement;
    expect(wrapper?.tagName).toBe('SPAN');
    expect(wrapper?.className).toContain('inline-flex');
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox data-testid="cb" aria-label="row" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('cb'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reflects the indeterminate prop on the DOM input', () => {
    render(<Checkbox data-testid="cb" aria-label="row" indeterminate />);
    const input = screen.getByTestId('cb') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it('clears DOM indeterminate when the prop transitions to false', () => {
    const { rerender } = render(
      <Checkbox data-testid="cb" aria-label="row" indeterminate />,
    );
    const input = screen.getByTestId('cb') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);

    rerender(<Checkbox data-testid="cb" aria-label="row" indeterminate={false} />);
    expect(input.indeterminate).toBe(false);
  });

  it('renders the dash indicator when indeterminate and the check indicator otherwise', () => {
    const { container, rerender } = render(
      <Checkbox data-testid="cb" aria-label="row" indeterminate />,
    );
    // Lucide icons render as inline SVGs — assert by lucide class.
    expect(container.querySelector('svg.lucide-minus')).not.toBeNull();
    expect(container.querySelector('svg.lucide-check')).toBeNull();

    rerender(<Checkbox data-testid="cb" aria-label="row" indeterminate={false} />);
    expect(container.querySelector('svg.lucide-check')).not.toBeNull();
    expect(container.querySelector('svg.lucide-minus')).toBeNull();
  });

  it('applies disabled attribute and the disabled-opacity utility', () => {
    render(<Checkbox data-testid="cb" aria-label="row" disabled />);
    const input = screen.getByTestId('cb') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.className).toContain('disabled:opacity-40');
    expect(input.className).toContain('disabled:cursor-not-allowed');
  });

  it('forwards refs to the underlying input', () => {
    let captured: HTMLInputElement | null = null;
    function Host() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Checkbox
          ref={(el) => {
            ref.current = el;
            captured = el;
          }}
          data-testid="cb"
          aria-label="row"
        />
      );
    }
    render(<Host />);
    expect(captured).not.toBeNull();
    expect(captured?.tagName).toBe('INPUT');
  });

  it('uses small dimensions when size="sm"', () => {
    render(<Checkbox data-testid="cb" aria-label="row" size="sm" />);
    const input = screen.getByTestId('cb');
    expect(input.className).toContain('h-3.5');
    expect(input.className).toContain('w-3.5');
  });
});
