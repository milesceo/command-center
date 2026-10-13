// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App shell', () => {
  it('renders the sidebar, empty chat state and toggles theme', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    expect(screen.getByText('What are we building?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('opens and closes the preview panel', () => {
    render(<App />);
    expect(screen.queryByLabelText('Preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /toggle preview panel/i }));
    expect(screen.getByLabelText('Preview')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close preview panel/i }));
    expect(screen.queryByLabelText('Preview')).toBeNull();
  });
});
