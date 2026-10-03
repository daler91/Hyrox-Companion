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
            retry: { content: 'Hi', userMessageId: 'u1' },
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
  describe('GitHub-flavoured markdown', () => {
    const table = [
      '| Split | Pace |',
      '| --- | --- |',
      '| 1 km | 4:05 |',
      '| 2 km | 4:02 |',
    ].join('\n');

    it('renders a table as a table, in a horizontal scroll wrapper', () => {
      const { container } = render(<ChatMessage role="assistant" content={table} />);
      const rendered = container.querySelector('table');
      expect(rendered).not.toBeNull();
      expect(screen.getByRole('columnheader', { name: 'Pace' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '4:02' })).toBeInTheDocument();
      expect(rendered?.parentElement).toHaveClass('overflow-x-auto');
      expect(container.textContent).not.toContain('| ---');
    });

    it('renders strikethrough', () => {
      const { container } = render(<ChatMessage role="assistant" content="~~6 x 800 m~~ 5 x 800 m" />);
      expect(container.querySelector('del')).toHaveTextContent('6 x 800 m');
    });

    it('still sanitizes raw HTML inside a table cell', () => {
      const { container } = render(
        <ChatMessage
          role="assistant"
          content={'| a | b |\n| --- | --- |\n| <img src=x onerror="window.__xssMarker = true"> | ok |'}
        />,
      );
      expect(container.innerHTML).not.toMatch(/onerror=/i);
      expect((globalThis as unknown as { __xssMarker?: boolean }).__xssMarker).toBeUndefined();
    });

    it('does not turn a javascript: autolink into a live link', () => {
      const { container } = render(<ChatMessage role="assistant" content="see javascript:alert(1) and www.example.com" />);
      expect(container.innerHTML).not.toMatch(/href=["']?javascript:/i);
    });
  });

  describe('a reply that is still streaming (I21)', () => {
    // Spread, so the component's `role` prop isn't read as an ARIA role.
    const reply = { role: 'assistant', messageId: 'reply-1' } as const;

    it('keeps its text out of the live region until complete, then mounts it fresh to be read once', () => {
      const { rerender } = render(<ChatMessage {...reply} content="Ease off" streaming />);
      const streaming = screen.getByText('Ease off').closest('[aria-busy]');
      expect(streaming).toHaveAttribute('aria-busy', 'true');
      expect(streaming).toHaveAttribute('aria-live', 'off');

      rerender(<ChatMessage {...reply} content="Ease off the pace today." />);
      const complete = screen.getByText('Ease off the pace today.').parentElement;
      expect(complete).not.toHaveAttribute('aria-busy');
      expect(complete).not.toHaveAttribute('aria-live');
      expect(complete).not.toBe(streaming);
    });

    it("keeps the safety notice announced while the text streams", () => {
      render(<ChatMessage {...reply} content="" streaming safetyNotice={{ level: 'urgent', message: 'Seek medical care now.' }} />);
      expect(screen.getByRole('alert').closest('[aria-busy]')).toBeNull();
    });
  });

  describe('rating a reply', () => {
    // Spread, so the component's `role` prop isn't read as an ARIA role.
    const reply = { role: 'assistant', content: 'Run easy.', messageId: 'reply-1' } as const;

    it('offers thumbs on a saved coach reply, and reports which was pressed', async () => {
      const onFeedback = vi.fn();
      render(<ChatMessage {...reply} onFeedback={onFeedback} />);

      await userEvent.click(screen.getByRole('button', { name: 'Helpful' }));

      expect(onFeedback).toHaveBeenCalledWith('reply-1', 'up');
      expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('clears the rating when the chosen thumb is pressed again', async () => {
      const onFeedback = vi.fn();
      render(<ChatMessage {...reply} feedback="down" onFeedback={onFeedback} />);

      const notHelpful = screen.getByRole('button', { name: 'Not helpful' });
      expect(notHelpful).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(notHelpful);

      expect(onFeedback).toHaveBeenCalledWith('reply-1', null);
    });

    it('offers no thumbs on the athlete\'s own message, a failed reply, or one with no handler', () => {
      const onFeedback = vi.fn();
      const own = { ...reply, role: 'user', content: 'Hi', messageId: 'm-1' } as const;
      const { rerender } = render(<ChatMessage {...own} onFeedback={onFeedback} />);
      expect(screen.queryByTestId('message-feedback')).not.toBeInTheDocument();

      rerender(<ChatMessage {...reply} content="" messageId="m-2" onFeedback={onFeedback} failure={{ message: 'The reply stopped.' }} />);
      expect(screen.queryByTestId('message-feedback')).not.toBeInTheDocument();

      rerender(<ChatMessage {...reply} content="Welcome!" messageId="welcome" />);
      expect(screen.queryByTestId('message-feedback')).not.toBeInTheDocument();
    });
  });

  describe('a photo on an athlete message (I20)', () => {
    it('notes the photo on a message sent from this tab', () => {
      render(<ChatMessage role="user" content="How was my pacing?" attachment={{ kind: 'photo' }} />);

      expect(screen.getByTestId('message-photo')).toHaveTextContent('Photo attached');
    });

    it('carries what the coach read in it once the message comes back from the history', () => {
      render(
        <ChatMessage
          role="user"
          content="How was my pacing?"
          attachment={{ kind: 'photo', reading: 'Watch summary: 10 km in 45:12.' }}
        />,
      );

      const note = screen.getByTestId('message-photo');
      expect(note.tagName).toBe('DETAILS');
      expect(note).toHaveTextContent('Photo attached: what the coach read');
      expect(note).toHaveTextContent('Watch summary: 10 km in 45:12.');
    });
  });
});
