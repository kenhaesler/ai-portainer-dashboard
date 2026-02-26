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

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue('Dashboard-Admins');
    expect(inputs[1]).toHaveValue('Viewers');
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
});
