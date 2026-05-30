import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BpfFilterInput } from './bpf-filter-input';

describe('BpfFilterInput', () => {
  it('renders the current value', () => {
    render(<BpfFilterInput value="port 80" onChange={() => {}} />);
    expect(screen.getByLabelText('BPF filter')).toHaveValue('port 80');
  });
  it('sets the value to the preset when empty', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'tcp' }));
    expect(onChange).toHaveBeenCalledWith('tcp');
  });
  it('appends the preset to an existing value', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="port 80" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'udp' }));
    expect(onChange).toHaveBeenCalledWith('port 80 udp');
  });
  it('edits via free text', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('BPF filter'), { target: { value: 'icmp' } });
    expect(onChange).toHaveBeenCalledWith('icmp');
  });
});
