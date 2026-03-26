import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachingMaterialList } from '../CoachingMaterialList';
import * as React from 'react';
import { useCoachingMaterials } from '@/hooks/useCoachingMaterials';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hook to provide test data
vi.mock('@/hooks/useCoachingMaterials', () => ({
  useCoachingMaterials: vi.fn(),
  useDeleteCoachingMaterial: () => ({ mutate: vi.fn(), isPending: false })
}));

const queryClient = new QueryClient();

test('CoachingMaterialList delete button has correct aria-label and title', () => {
  // Setup mock data
  const mockMaterials = [
    { id: '1', title: 'Test Principle', content: 'Always lift heavy', type: 'principles' }
  ];

  (useCoachingMaterials as any).mockReturnValue({
    data: mockMaterials,
    isLoading: false
  });

  const mockOpenPrinciplesDialog = vi.fn();
  const mockHandleFileUpload = vi.fn();
  const mockFileInputRef = { current: null } as any;

  render(
    <QueryClientProvider client={queryClient}>
      <CoachingMaterialList
        openPrinciplesDialog={mockOpenPrinciplesDialog}
        handleFileUpload={mockHandleFileUpload}
        fileInputRef={mockFileInputRef}
      />
    </QueryClientProvider>
  );

  // Find the delete button
  const deleteButton = screen.getByRole('button', { name: 'Delete Test Principle' });

  // Verify it exists and has the correct attributes
  expect(deleteButton).toBeInTheDocument();
  expect(deleteButton).toHaveAttribute('aria-label', 'Delete Test Principle');
  expect(deleteButton).toHaveAttribute('title', 'Delete Test Principle');
});
