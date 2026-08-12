import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, readTheme } from './util/appearance';

// Before the first paint, so a saved theme never flashes the default first.
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
