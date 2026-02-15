import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EndpointHealthOctagons, getHealthLevel_testable } from './endpoint-health-octagons';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { variants: _v, initial: _i, animate: _a, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

const ENDPOINTS = [
  { id: 1, name: 'Production', running: 9, stopped: 1, total: 10 },
  { id: 2, name: 'Staging', running: 4, stopped: 4, total: 8 },
  { id: 3, name: 'Dev', running: 1, stopped: 5, total: 6 },
  { id: 4, name: 'Empty', running: 0, stopped: 0, total: 0 },
];

describe('EndpointHealthOctagons', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders one octagon per endpoint', () => {
    render(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    expect(screen.getByTestId('octagon-Production')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Staging')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Dev')).toBeInTheDocument();
    expect(screen.getByTestId('octagon-Empty')).toBeInTheDocument();
  });

  it('displays endpoint name and running count', () => {
    render(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('9/10 running')).toBeInTheDocument();
    expect(screen.getByText('No containers')).toBeInTheDocument();
  });

  it('handles empty endpoints array', () => {
    render(<EndpointHealthOctagons endpoints={[]} />);
    expect(screen.getByText('No endpoint data')).toBeInTheDocument();
  });

  it('shows loading spinner when isLoading', () => {
    const { container } = render(<EndpointHealthOctagons endpoints={[]} isLoading />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('navigates to /fleet on click', () => {
    render(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    fireEvent.click(screen.getByTestId('octagon-Production'));
    expect(mockNavigate).toHaveBeenCalledWith('/fleet');
  });

  it('renders the legend', () => {
    render(<EndpointHealthOctagons endpoints={ENDPOINTS} />);
    expect(screen.getByText('>80% healthy')).toBeInTheDocument();
    expect(screen.getByText('50-80%')).toBeInTheDocument();
    expect(screen.getByText('<50%')).toBeInTheDocument();
  });
});

describe('getHealthLevel', () => {
  it('returns good for >80% ratio', () => {
    expect(getHealthLevel_testable(9, 10)).toBe('good');
    expect(getHealthLevel_testable(10, 10)).toBe('good');
  });

  it('returns warning for 50-80% ratio', () => {
    expect(getHealthLevel_testable(5, 10)).toBe('warning');
    expect(getHealthLevel_testable(8, 10)).toBe('warning');
  });

  it('returns critical for <50% ratio', () => {
    expect(getHealthLevel_testable(1, 10)).toBe('critical');
    expect(getHealthLevel_testable(4, 10)).toBe('critical');
  });

  it('returns empty when total is 0', () => {
    expect(getHealthLevel_testable(0, 0)).toBe('empty');
  });
});
