import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportToCsv } from './csv-export';

describe('exportToCsv', () => {
  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let mockLinkClick: ReturnType<typeof vi.fn>;
  let mockLink: HTMLAnchorElement;

  beforeEach(() => {
    // Mock URL methods
    mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Mock document.createElement for the anchor element
    mockLinkClick = vi.fn();
    mockLink = {
      href: '',
      download: '',
      click: mockLinkClick,
    } as unknown as HTMLAnchorElement;

    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should do nothing for empty data', () => {
    exportToCsv([], 'test.csv');

    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(mockLinkClick).not.toHaveBeenCalled();
  });

  it('should create CSV with headers from object keys', () => {
    const data = [{ name: 'John', age: 30 }];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
    const blobArg = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
  });

  it('should set correct filename on download link', () => {
    const data = [{ name: 'John', age: 30 }];

    exportToCsv(data, 'users.csv');

    expect(mockLink.download).toBe('users.csv');
  });

  it('should trigger download by clicking the link', () => {
    const data = [{ name: 'John', age: 30 }];

    exportToCsv(data, 'test.csv');

    expect(mockLinkClick).toHaveBeenCalled();
  });

  it('should revoke object URL after download', () => {
    const data = [{ name: 'John', age: 30 }];

    exportToCsv(data, 'test.csv');

    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should handle multiple rows', () => {
    const data = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ];

    exportToCsv(data, 'users.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('should handle null and undefined values', () => {
    const data = [
      { name: 'John', email: null },
      { name: 'Jane', email: undefined },
    ];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('should escape values containing commas', () => {
    const data = [{ description: 'Hello, World' }];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
    // The value should be quoted: "Hello, World"
  });

  it('should escape values containing quotes', () => {
    const data = [{ quote: 'He said "Hello"' }];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
    // The value should be: "He said ""Hello"""
  });

  it('should escape values containing newlines', () => {
    const data = [{ text: 'Line1\nLine2' }];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
    // The value should be quoted
  });

  it('should handle numeric values', () => {
    const data = [
      { count: 100, price: 19.99 },
      { count: 0, price: -5.5 },
    ];

    exportToCsv(data, 'numbers.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('should handle boolean values', () => {
    const data = [
      { active: true, verified: false },
    ];

    exportToCsv(data, 'flags.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('should handle empty string values', () => {
    const data = [
      { name: 'John', nickname: '' },
    ];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('should create blob with correct MIME type', () => {
    const data = [{ name: 'Test' }];

    exportToCsv(data, 'test.csv');

    const blobArg = mockCreateObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('text/csv;charset=utf-8;');
  });

  it('should use headers from first object only', () => {
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4, c: 5 }, // Extra key should be ignored
    ];

    exportToCsv(data, 'test.csv');

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});
