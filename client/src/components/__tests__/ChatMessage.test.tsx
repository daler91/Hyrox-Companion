import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';
import { describe, expect,it } from 'vitest';

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
});
