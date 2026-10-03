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
});
