import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandableRow } from './expandable-row';

describe('ExpandableRow', () => {
  it('renders trigger content', () => {
    render(
      <ExpandableRow expanded={false} onToggle={() => {}} trigger={<span>Row Title</span>}>
        <div>Detail</div>
      </ExpandableRow>,
    );

    expect(screen.getByText('Row Title')).toBeInTheDocument();
  });

  it('renders custom trigger slot', () => {
    render(
      <ExpandableRow
        expanded={false}
        onToggle={() => {}}
        trigger={<span data-testid="custom-trigger">Custom</span>}
      >
        <div>Detail</div>
      </ExpandableRow>,
    );

    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument();
  });

  it('shows content when expanded', () => {
    render(
      <ExpandableRow expanded={true} onToggle={() => {}} trigger={<span>Title</span>}>
        <div>Expanded Content</div>
      </ExpandableRow>,
    );

    expect(screen.getByText('Expanded Content')).toBeInTheDocument();
    expect(screen.getByTestId('expandable-row-content')).toBeInTheDocument();
  });

  it('hides content when collapsed', () => {
    render(
      <ExpandableRow expanded={false} onToggle={() => {}} trigger={<span>Title</span>}>
        <div>Hidden Content</div>
      </ExpandableRow>,
    );

    expect(screen.queryByTestId('expandable-row-content')).not.toBeInTheDocument();
  });

  it('calls onToggle when trigger is clicked', () => {
    const onToggle = vi.fn();
    render(
      <ExpandableRow expanded={false} onToggle={onToggle} trigger={<span>Title</span>}>
        <div>Detail</div>
      </ExpandableRow>,
    );

    fireEvent.click(screen.getByTestId('expandable-row-trigger'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders a chevron icon', () => {
    render(
      <ExpandableRow expanded={false} onToggle={() => {}} trigger={<span>Title</span>}>
        <div>Detail</div>
      </ExpandableRow>,
    );

    expect(screen.getByTestId('expandable-row-chevron')).toBeInTheDocument();
  });
});
