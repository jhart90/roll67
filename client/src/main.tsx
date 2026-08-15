import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorScreen } from './ErrorScreen';
import './styles.css';
import { applyTheme, readTheme } from './util/appearance';

// Before the first paint, so a saved theme never flashes the default first.
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* The floor: a render error shows a reload screen, never a black page. */}
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </React.StrictMode>,
);
