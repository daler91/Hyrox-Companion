import { describe, it, expect, vi, beforeEach } from 'vitest';
import { typedRequest, rawRequest } from './client';
import { apiRequest } from '../queryClient';

// Mock the queryClient module
vi.mock('../queryClient', () => ({
  apiRequest: vi.fn(),
}));

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('typedRequest', () => {
    it('should call apiRequest with method and url when no data is provided', async () => {
      const mockData = { success: true };
      const mockResponse = { json: vi.fn().mockResolvedValue(mockData) };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse as unknown as Response);

      const result = await typedRequest('GET', '/api/test');

      expect(apiRequest).toHaveBeenCalledWith('GET', '/api/test');
      expect(mockResponse.json).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it('should call apiRequest with method, url, and data when data is provided', async () => {
      const mockData = { id: 1 };
      const requestData = { name: 'Test' };
      const mockResponse = { json: vi.fn().mockResolvedValue(mockData) };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse as unknown as Response);

      const result = await typedRequest('POST', '/api/test', requestData);

      expect(apiRequest).toHaveBeenCalledWith('POST', '/api/test', requestData);
      expect(mockResponse.json).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it('should bubble up errors from apiRequest', async () => {
      const mockError = new Error('Network error');
      vi.mocked(apiRequest).mockRejectedValue(mockError);

      await expect(typedRequest('GET', '/api/test')).rejects.toThrow('Network error');
    });
  });

  describe('rawRequest', () => {
    it('should call apiRequest with method and url when no data is provided', async () => {
      const mockResponse = new Response();
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await rawRequest('GET', '/api/test');

      expect(apiRequest).toHaveBeenCalledWith('GET', '/api/test');
      expect(result).toBe(mockResponse);
    });

    it('should call apiRequest with method, url, and data when data is provided', async () => {
      const requestData = { name: 'Test' };
      const mockResponse = new Response();
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await rawRequest('POST', '/api/test', requestData);

      expect(apiRequest).toHaveBeenCalledWith('POST', '/api/test', requestData);
      expect(result).toBe(mockResponse);
    });

    it('should bubble up errors from apiRequest', async () => {
      const mockError = new Error('Network error');
      vi.mocked(apiRequest).mockRejectedValue(mockError);

      await expect(rawRequest('GET', '/api/test')).rejects.toThrow('Network error');
    });
  });
});
