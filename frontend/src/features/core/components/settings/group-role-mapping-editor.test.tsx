import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupRoleMappingEditor } from './group-role-mapping-editor';

describe('GroupRoleMappingEditor', () => {
  it('should render empty state when no mappings configured', () => {
    render(<GroupRoleMappingEditor value="{}" onChange={vi.fn()} />);
    expect(screen.getByText(/No mappings configured/)).toBeInTheDocument();
  });

  it('should render existing mappings from JSON value', () => {
    const value = JSON.stringify({ 'Dashboard-Admins': 'admin', 'Viewers': 'viewer' });
    render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

    expect(screen.getByTestId('mapping-group-0')).toHaveValue('Dashboard-Admins');
    expect(screen.getByTestId('mapping-group-1')).toHaveValue('Viewers');
    // Only one group input per row (and one role select per row).
    expect(screen.queryByTestId('mapping-group-2')).not.toBeInTheDocument();
  });

  it('should add a new empty row when Add Mapping is clicked', () => {
    const onChange = vi.fn();
    render(<GroupRoleMappingEditor value="{}" onChange={onChange} />);

    fireEvent.click(screen.getByText('Add Mapping'));
    expect(onChange).toHaveBeenCalledWith('{}');
  });

  it('should remove a row when delete button is clicked', () => {
    const onChange = vi.fn();
    const value = JSON.stringify({ 'Admins': 'admin', 'Viewers': 'viewer' });
    render(<GroupRoleMappingEditor value={value} onChange={onChange} />);

    const removeButtons = screen.getAllByRole('button', { name: /Remove mapping/i });
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ 'Viewers': 'viewer' }));
  });

  it('should update group name when input changes', () => {
    const onChange = vi.fn();
    const value = JSON.stringify({ 'OldName': 'admin' });
    render(<GroupRoleMappingEditor value={value} onChange={onChange} />);

    const input = screen.getByTestId('mapping-group-0');
    fireEvent.change(input, { target: { value: 'NewName' } });

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ 'NewName': 'admin' }));
  });

  it('should update role when select changes', () => {
    const onChange = vi.fn();
    const value = JSON.stringify({ 'Operators': 'viewer' });
    render(<GroupRoleMappingEditor value={value} onChange={onChange} />);

    const select = screen.getByTestId('mapping-role-0');
    fireEvent.change(select, { target: { value: 'operator' } });

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ 'Operators': 'operator' }));
  });

  it('should render all three role options in the dropdown', () => {
    const value = JSON.stringify({ 'Test': 'viewer' });
    render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

    const select = screen.getByTestId('mapping-role-0');
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveValue('viewer');
    expect(options[1]).toHaveValue('operator');
    expect(options[2]).toHaveValue('admin');
  });

  it('should handle invalid JSON gracefully', () => {
    render(<GroupRoleMappingEditor value="not-json" onChange={vi.fn()} />);
    expect(screen.getByText(/No mappings configured/)).toBeInTheDocument();
  });

  it('should be disabled when disabled prop is true', () => {
    const value = JSON.stringify({ 'Admins': 'admin' });
    render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} disabled />);

    expect(screen.getByTestId('mapping-group-0')).toBeDisabled();
    expect(screen.getByTestId('mapping-role-0')).toBeDisabled();
    expect(screen.getByText('Add Mapping')).toBeDisabled();
  });

  it('should strip empty group names from serialized output', () => {
    const onChange = vi.fn();
    const value = JSON.stringify({ 'Admins': 'admin' });
    render(<GroupRoleMappingEditor value={value} onChange={onChange} />);

    // Change the group name to empty
    const input = screen.getByTestId('mapping-group-0');
    fireEvent.change(input, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('{}');
  });

  describe('GroupNameAutocomplete', () => {
    it('exposes ARIA combobox semantics', () => {
      const value = JSON.stringify({ 'Admins': 'admin' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);
      const input = screen.getByTestId('mapping-group-0');
      expect(input).toHaveAttribute('role', 'combobox');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
      // Initially closed (no suggestions, single row with own value excluded)
      expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not show the row\'s own value as a suggestion when focused', () => {
      // Object with an empty-string key gives us a row whose query is '' (no filter),
      // so the dropdown opens with every existingGroup. Row 0 should NOT see its own
      // value ('') and row 1 should NOT see its own value ('Admins').
      const value = JSON.stringify({ '': 'viewer', 'Admins': 'admin' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      const firstInput = screen.getByTestId('mapping-group-0');
      fireEvent.focus(firstInput);

      // Row 0 (empty value) sees row 1's value ('Admins') as a suggestion.
      expect(screen.getByRole('option', { name: 'Admins' })).toBeInTheDocument();
    });

    it('filters suggestions as the user types', () => {
      const value = JSON.stringify({
        '': 'viewer',
        'Viewers': 'viewer',
        'Operators': 'operator',
      });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      const firstInput = screen.getByTestId('mapping-group-0');
      fireEvent.focus(firstInput);
      fireEvent.change(firstInput, { target: { value: 'view' } });

      expect(screen.getByRole('option', { name: 'Viewers' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Operators' })).not.toBeInTheDocument();
    });

    it('commits a suggestion on mouse click', () => {
      const value = JSON.stringify({ '': 'viewer', 'Admins': 'admin' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      const firstInput = screen.getByTestId('mapping-group-0');
      fireEvent.focus(firstInput);

      const option = screen.getByRole('option', { name: 'Admins' });
      fireEvent.mouseDown(option);

      // The autocomplete commits 'Admins' into the empty input.
      expect(firstInput).toHaveValue('Admins');
      // Listbox closes after commit.
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('selects highlighted option on Enter and closes the listbox', () => {
      const value = JSON.stringify({ '': 'viewer', 'Admins': 'admin' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      const firstInput = screen.getByTestId('mapping-group-0');
      fireEvent.focus(firstInput);
      fireEvent.keyDown(firstInput, { key: 'ArrowDown' });
      fireEvent.keyDown(firstInput, { key: 'Enter' });

      expect(firstInput).toHaveValue('Admins');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes the listbox on Escape without committing', () => {
      const value = JSON.stringify({ '': 'viewer', 'Admins': 'admin' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      const firstInput = screen.getByTestId('mapping-group-0');
      fireEvent.focus(firstInput);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(firstInput, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      // Value was never committed — input is still empty.
      expect(firstInput).toHaveValue('');
    });

    it('dedupes suggestions when multiple rows share a value', () => {
      // Start with one row + one empty row, then change row 1's value to match row 0
      // before opening row 2's dropdown. After the dedup we expect ONE 'Same' option.
      const value = JSON.stringify({ 'Same': 'admin', 'Other': 'viewer' });
      render(<GroupRoleMappingEditor value={value} onChange={vi.fn()} />);

      // Duplicate row 0's value into row 1, then blur to keep that listbox closed.
      const secondInput = screen.getByTestId('mapping-group-1');
      fireEvent.focus(secondInput);
      fireEvent.change(secondInput, { target: { value: 'Same' } });
      fireEvent.blur(secondInput);

      // Add a third (empty) row and focus it so we see ITS listbox.
      fireEvent.click(screen.getByText('Add Mapping'));
      const thirdInput = screen.getByTestId('mapping-group-2');
      fireEvent.focus(thirdInput);

      // Only one open listbox; assert 'Same' appears once and is not duplicated.
      const listbox = screen.getByRole('listbox');
      const options = Array.from(listbox.querySelectorAll('[role="option"]')).map(
        (el) => el.textContent,
      );
      expect(options.filter((t) => t === 'Same')).toHaveLength(1);
    });
  });
});
