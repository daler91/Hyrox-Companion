import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatMessage } from '../ChatMessage';

describe('ChatMessage', () => {
  it('renders a user message correctly', () => {
    render(<ChatMessage role="user" content="Hello, world!" />);
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
  });

  it('renders an assistant message correctly', () => {
    render(<ChatMessage role="assistant" content="How can I help you today?" />);
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('applies correct styling for user messages', () => {
    render(<ChatMessage role="user" content="Test styling" />);
    const messageContainer = screen.getByTestId('message-user');
    expect(messageContainer).toHaveClass('flex-row-reverse');

    // Check if the actual text container has the correct background
    const textContainer = screen.getByText('Test styling').parentElement;
    expect(textContainer).toHaveClass('bg-primary');
    expect(textContainer).toHaveClass('text-primary-foreground');
  });

  it('applies correct styling for assistant messages', () => {
    render(<ChatMessage role="assistant" content="Test styling" />);
    const messageContainer = screen.getByTestId('message-assistant');
    expect(messageContainer).not.toHaveClass('flex-row-reverse');

    // For assistant messages, ReactMarkdown wraps content in a prose div inside the card div
    const textEl = screen.getByText('Test styling');
    const cardContainer = textEl.closest('.bg-card');
    expect(cardContainer).toBeInTheDocument();
    expect(cardContainer).toHaveClass('border');
  });

  it('renders timestamp when provided', () => {
    render(<ChatMessage role="user" content="Time check" timestamp="10:30 AM" />);
    expect(screen.getByText('10:30 AM')).toBeInTheDocument();
  });

  it('does not render timestamp when omitted', () => {
    render(<ChatMessage role="user" content="No time" />);
    const timestampElements = screen.queryByText(/AM|PM|\d{1,2}:\d{2}/);
    expect(timestampElements).not.toBeInTheDocument();
  });

  describe('assistant XSS sanitization (C2)', () => {
    it('does not render a <script> tag injected into AI markdown', () => {
      const { container } = render(
        <ChatMessage
          role="assistant"
          content={'before<script>window.__xssMarker = true;</script>after'}
        />,
      );
      // rehype-sanitize must drop the script element entirely (react-markdown
      // would already refuse to execute it, but the element shouldn't appear
      // in the DOM either).
      expect(container.querySelector('script')).toBeNull();
      expect((globalThis as unknown as { __xssMarker?: boolean }).__xssMarker).toBeUndefined();
    });

    it('strips javascript: URLs from markdown links', () => {
      const { container } = render(
        <ChatMessage
          role="assistant"
          content={'[click me](javascript:alert(1))'}
        />,
      );
      // The link element may or may not render; what matters is that no
      // javascript:-scheme href survives in the rendered HTML.
      expect(container.innerHTML).not.toMatch(/href=["']?javascript:/i);
    });

    it('strips inline event handlers from raw HTML in markdown', () => {
      const { container } = render(
        <ChatMessage
          role="assistant"
          content={'<img src=x onerror="window.__xssMarker = true">'}
        />,
      );
      expect(container.innerHTML).not.toMatch(/onerror=/i);
      expect((globalThis as unknown as { __xssMarker?: boolean }).__xssMarker).toBeUndefined();
    });
  });
  describe('failed replies', () => {
    it('shows only the failure note when no text arrived', () => {
      render(<ChatMessage role="assistant" content="" failure={{ message: 'Your connection dropped.' }} />);
      expect(screen.getByTestId('message-failure')).toHaveTextContent('Your connection dropped.');
      expect(screen.queryByTestId('button-retry-message')).not.toBeInTheDocument();
    });

    it('keeps the text that arrived above the failure note', () => {
      render(<ChatMessage role="assistant" content="Start with a" failure={{ message: 'Stopped.' }} />);
      expect(screen.getByText('Start with a')).toBeInTheDocument();
      expect(screen.getByTestId('message-failure')).toHaveTextContent('Stopped.');
    });

    it('offers Try again when a retry handler is given', async () => {
      const onRetry = vi.fn();
      render(
        <ChatMessage
          role="assistant"
          content=""
          failure={{
            message: 'Something went wrong on our side. Please try again.',
            retry: { content: 'Hi', userMessageId: 'u1', userSaved: false },
          }}
          onRetry={onRetry}
        />,
      );
      await userEvent.click(screen.getByTestId('button-retry-message'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
  describe('safety notices', () => {
    it('announces the urgent escalation as an alert, above the reply', () => {
      render(
        <ChatMessage
          role="assistant"
          content="Please get checked before training."
          safetyNotice={{ level: 'urgent', message: 'Pause hard training and seek prompt medical care.' }}
        />,
      );
      const banner = screen.getByRole('alert');
      expect(banner).toHaveTextContent('Pause hard training and seek prompt medical care.');
      expect(banner).toHaveAttribute('data-testid', 'safety-notice-urgent');
      expect(
        banner.compareDocumentPosition(screen.getByText('Please get checked before training.')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('shows the medication disclaimer as a note, not an alert', () => {
      render(
        <ChatMessage
          role="assistant"
          content="Use RPE."
          safetyNotice={{ level: 'caution', message: 'Heart-rate zones can be unreliable.' }}
        />,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent('Heart-rate zones can be unreliable.');
    });
  });
});
