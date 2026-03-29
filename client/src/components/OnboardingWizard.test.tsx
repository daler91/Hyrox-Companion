import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

// Mock child components to isolate OnboardingWizard
vi.mock('@/components/onboarding/WelcomeStep', () => ({
  WelcomeStep: () => <div data-testid="welcome-step">WelcomeStep</div>,
}));
vi.mock('@/components/onboarding/UnitsStep', () => ({
  UnitsStep: ({ onWeightUnitChange, onDistanceUnitChange }: { onWeightUnitChange: (v: string) => void; onDistanceUnitChange: (v: string) => void }) => (
    <div data-testid="units-step">
      <button onClick={() => onWeightUnitChange('lbs')}>Set Weight</button>
      <button onClick={() => onDistanceUnitChange('miles')}>Set Distance</button>
    </div>
  ),
}));
vi.mock('@/components/onboarding/GoalStep', () => ({
  GoalStep: () => <div data-testid="goal-step">GoalStep</div>,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

// We need to mock the entire lib/queryClient module including apiRequest and queryClient
vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('OnboardingWizard Error Handling', () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<typeof useToast>);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OnboardingWizard open={true} onComplete={mockOnComplete} />
      </QueryClientProvider>
    );
  };

  it('shows error toast when preferences mutation fails', async () => {
    renderComponent();

    // The wizard starts at the 'welcome' step.
    // Click "Get Started" to move to 'units' step.
    fireEvent.click(screen.getByText('Get Started'));

    // Wait for the units step to render
    await screen.findByTestId('units-step');

    // In the units step, clicking "Continue" calls handleNext(), which triggers prefsMutation.
    // We mock the API request to fail for the /api/preferences endpoint.
    const { apiRequest } = await import('@/lib/queryClient');
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Failed to save preferences'));

    fireEvent.click(screen.getByText('Continue'));

    // Wait for the mutation to settle and toast to be called
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Could not save preferences",
        description: "You can update them later in settings.",
        variant: "destructive",
      });
    });

    // The step should advance to 'goal' step despite the error
    await screen.findByTestId('goal-step');
  });
});
