import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContainerMultiSelect, type ContainerOption } from './container-multi-select';

function makeContainers(count: number, options?: { stack?: string }): ContainerOption[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i + 1}`,
    name: `container-${i + 1}`,
    state: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'stopped' : 'paused',
    labels: options?.stack ? { 'com.docker.compose.project': options.stack } : {},
  }));
}

const stackedContainers: ContainerOption[] = [
  { id: 'web-1', name: 'web-frontend', state: 'running', labels: { 'com.docker.compose.project': 'myapp' } },
  { id: 'web-2', name: 'web-backend', state: 'running', labels: { 'com.docker.compose.project': 'myapp' } },
  { id: 'db-1', name: 'postgres', state: 'running', labels: { 'com.docker.compose.project': 'database' } },
  { id: 'standalone-1', name: 'nginx-proxy', state: 'stopped', labels: {} },
  { id: 'standalone-2', name: 'redis', state: 'running', labels: {} },
];

describe('ContainerMultiSelect', () => {
  describe('rendering', () => {
    it('renders the trigger button with placeholder', () => {
      render(<ContainerMultiSelect containers={[]} selected={[]} onChange={() => {}} />);
      expect(screen.getByText('Select containers...')).toBeInTheDocument();
    });

    it('renders with selected container names', () => {
      const containers = makeContainers(3);
      render(
        <ContainerMultiSelect containers={containers} selected={['id-1', 'id-2']} onChange={() => {}} />,
      );
      expect(screen.getByText('container-1, container-2')).toBeInTheDocument();
    });

    it('shows count when more than 3 containers selected', () => {
      const containers = makeContainers(5);
      render(
        <ContainerMultiSelect
          containers={containers}
          selected={['id-1', 'id-2', 'id-3', 'id-4']}
          onChange={() => {}}
        />,
      );
      expect(screen.getByText('4 containers selected')).toBeInTheDocument();
    });

    it('displays count badge', () => {
      const containers = makeContainers(5);
      render(
        <ContainerMultiSelect containers={containers} selected={['id-1', 'id-2']} onChange={() => {}} />,
      );
      expect(screen.getByText('2/5')).toBeInTheDocument();
    });

    it('renders removable chips for selected containers', () => {
      const containers = makeContainers(2);
      render(
        <ContainerMultiSelect containers={containers} selected={['id-1']} onChange={() => {}} />,
      );
      expect(screen.getByRole('listitem')).toHaveTextContent('container-1');
      expect(screen.getByLabelText('Remove container-1')).toBeInTheDocument();
    });
  });

  describe('dropdown interaction', () => {
    it('opens dropdown on trigger click', () => {
      const containers = makeContainers(3);
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      const searchInput = screen.getByPlaceholderText('Search containers...');
      expect(searchInput).toBeInTheDocument();

      const searchWrapper = searchInput.parentElement;
      expect(searchWrapper).toBeTruthy();
      expect(searchWrapper).toHaveClass('relative');
    });

    it('closes dropdown on outside click', () => {
      const containers = makeContainers(3);
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />
        </div>,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes dropdown on Escape key', () => {
      const containers = makeContainers(3);
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('search filtering', () => {
    it('filters containers by name (case-insensitive)', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.change(screen.getByPlaceholderText('Search containers...'), {
        target: { value: 'WEB' },
      });

      expect(screen.getByText('web-frontend')).toBeInTheDocument();
      expect(screen.getByText('web-backend')).toBeInTheDocument();
      expect(screen.queryByText('postgres')).not.toBeInTheDocument();
      expect(screen.queryByText('nginx-proxy')).not.toBeInTheDocument();
    });

    it('shows no results message when search matches nothing', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.change(screen.getByPlaceholderText('Search containers...'), {
        target: { value: 'nonexistent' },
      });

      expect(screen.getByText(/No containers match/)).toBeInTheDocument();
    });

    it('clears search when clear button is clicked', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));

      const searchInput = screen.getByPlaceholderText('Search containers...');
      fireEvent.change(searchInput, { target: { value: 'web' } });
      expect(screen.queryByText('postgres')).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Clear search'));
      expect(screen.getByText('postgres')).toBeInTheDocument();
    });
  });

  describe('multi-select toggle', () => {
    it('calls onChange with added container id when clicking unselected container', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={onChange} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.click(screen.getByText('web-frontend'));

      expect(onChange).toHaveBeenCalledWith(['web-1']);
    });

    it('calls onChange with removed container id when clicking selected container', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect
          containers={stackedContainers}
          selected={['web-1', 'web-2']}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      // "web-frontend" appears in both chip and dropdown option; click the option
      const option = screen.getByRole('option', { name: /web-frontend/ });
      fireEvent.click(option);

      expect(onChange).toHaveBeenCalledWith(['web-2']);
    });

    it('removes container when clicking chip remove button', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect
          containers={stackedContainers}
          selected={['web-1']}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByLabelText('Remove web-frontend'));
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe('group rendering by stack label', () => {
    it('groups containers by compose project label', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));

      // Check group headers exist
      expect(screen.getByText('database')).toBeInTheDocument();
      expect(screen.getByText('myapp')).toBeInTheDocument();
      expect(screen.getByText('Standalone')).toBeInTheDocument();
    });

    it('places standalone containers in Standalone group', () => {
      const containers: ContainerOption[] = [
        { id: '1', name: 'solo-container', state: 'running', labels: {} },
      ];
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      expect(screen.getByText('Standalone')).toBeInTheDocument();
      expect(screen.getByText('solo-container')).toBeInTheDocument();
    });
  });

  describe('select all / clear all', () => {
    it('selects all containers when clicking Select All', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={onChange} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.click(screen.getByLabelText('Select all containers'));

      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining(['web-1', 'web-2', 'db-1', 'standalone-1', 'standalone-2']),
      );
    });

    it('clears all containers when clicking Clear All', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect
          containers={stackedContainers}
          selected={['web-1', 'web-2', 'db-1']}
          onChange={onChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.click(screen.getByLabelText('Clear all selected containers'));

      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('select all respects current search filter', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={onChange} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      fireEvent.change(screen.getByPlaceholderText('Search containers...'), {
        target: { value: 'web' },
      });
      fireEvent.click(screen.getByLabelText('Select all containers'));

      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(['web-1', 'web-2']));
      const call = onChange.mock.calls[0][0] as string[];
      expect(call).not.toContain('db-1');
      expect(call).not.toContain('standalone-1');
    });
  });

  describe('keyboard navigation', () => {
    it('navigates down with ArrowDown', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const listbox = screen.getByRole('listbox');

      act(() => {
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      });

      // First item should get focus styling
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveClass('bg-accent');
    });

    it('navigates up with ArrowUp', () => {
      render(<ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const listbox = screen.getByRole('listbox');

      // ArrowUp from -1 wraps to last item
      act(() => {
        fireEvent.keyDown(listbox, { key: 'ArrowUp' });
      });

      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toHaveClass('bg-accent');
    });

    it('toggles selection with Space on focused item', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={onChange} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const listbox = screen.getByRole('listbox');

      act(() => {
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      });
      fireEvent.keyDown(listbox, { key: ' ' });

      expect(onChange).toHaveBeenCalled();
    });

    it('toggles selection with Enter on focused item', () => {
      const onChange = vi.fn();
      render(
        <ContainerMultiSelect containers={stackedContainers} selected={[]} onChange={onChange} />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const listbox = screen.getByRole('listbox');

      act(() => {
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      });
      fireEvent.keyDown(listbox, { key: 'Enter' });

      expect(onChange).toHaveBeenCalled();
    });

    it('wraps focus from last to first item', () => {
      const containers = makeContainers(2);
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const listbox = screen.getByRole('listbox');

      act(() => {
        fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // index 0
        fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // index 1
        fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // wraps to 0
      });

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveClass('bg-accent');
    });
  });

  describe('state indicators', () => {
    it('shows green dot for running containers', () => {
      const containers: ContainerOption[] = [
        { id: '1', name: 'runner', state: 'running', labels: {} },
      ];
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const option = screen.getByRole('option');
      const dot = option.querySelector('.bg-emerald-500');
      expect(dot).toBeInTheDocument();
    });

    it('shows red dot for stopped containers', () => {
      const containers: ContainerOption[] = [
        { id: '1', name: 'stopped-one', state: 'stopped', labels: {} },
      ];
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const option = screen.getByRole('option');
      const dot = option.querySelector('.bg-red-500');
      expect(dot).toBeInTheDocument();
    });

    it('shows gray dot for unknown state containers', () => {
      const containers: ContainerOption[] = [
        { id: '1', name: 'unknown-one', state: 'created', labels: {} },
      ];
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const option = screen.getByRole('option');
      const dot = option.querySelector('.bg-gray-500');
      expect(dot).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper aria attributes on trigger', () => {
      const containers = makeContainers(5);
      render(
        <ContainerMultiSelect containers={containers} selected={['id-1']} onChange={() => {}} />,
      );

      const trigger = screen.getByRole('button', { name: /select containers/i });
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-expanded to true when open', () => {
      const containers = makeContainers(3);
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      const trigger = screen.getByRole('button', { name: /select containers/i });
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('listbox has multiselectable attribute', () => {
      const containers = makeContainers(3);
      render(<ContainerMultiSelect containers={containers} selected={[]} onChange={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    });

    it('options have aria-selected attribute', () => {
      render(
        <ContainerMultiSelect
          containers={stackedContainers}
          selected={['web-1']}
          onChange={() => {}}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /select containers/i }));
      const options = screen.getAllByRole('option');
      const selectedOption = options.find((opt) => opt.textContent?.includes('web-frontend'));
      expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    });
  });
});
