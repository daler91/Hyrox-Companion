import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageCaptureButton } from '../ImageCaptureButton';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe('ImageCaptureButton', () => {
  it('scans by default: the camera opens straight away', () => {
    render(<ImageCaptureButton onImage={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Scan a printed or whiteboard workout' })).toBeInTheDocument();
    expect(screen.getByTestId('button-image-capture-input')).toHaveAttribute('capture', 'environment');
  });

  it('attaches a photo from the gallery or the camera when that is its purpose', () => {
    render(<ImageCaptureButton onImage={vi.fn()} purpose="attach" data-testid="button-chat-photo" />);

    expect(screen.getByRole('button', { name: 'Attach a photo' })).toBeInTheDocument();
    const input = screen.getByTestId('button-chat-photo-input');
    expect(input).not.toHaveAttribute('capture');
    expect(input).toHaveAttribute('aria-label', 'Choose a photo');
  });

  // U34 (CODEBASE_ANALYSIS_2026-10-03): the hidden file input was a second tab
  // stop, labelled "Capture workout image" even on the meal scans.
  it('leaves the hidden file input out of the tab order and the accessibility tree', () => {
    render(<ImageCaptureButton onImage={vi.fn()} label="Snap a meal" data-testid="button-snap-meal" />);

    const input = screen.getByTestId('button-snap-meal-input');
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(input).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByLabelText(/workout image/i)).not.toBeInTheDocument();
  });
});
