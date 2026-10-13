import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { warmUpHighlighter } from './lib/rehype-lowlight';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

warmUpHighlighter();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
