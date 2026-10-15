import './lib/legacy-boot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Boot } from './Boot';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The splash renders from this tiny entry; the app itself is a separate chunk loaded behind it.
createRoot(root).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);

// Warm the syntax highlighter once the app is on its way (never on the first paint).
void import('./lib/highlight').then((m) => m.warmUpHighlighter());
