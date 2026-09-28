import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/index.css';
import { applyWindowMaterialAttributes } from './windowMaterial';

// Before the first render, so the first painted frame already matches the native window material.
applyWindowMaterialAttributes(window.janet?.initialWindowMaterial);
// One launch pass for the arrival choreography in motion.css; later mounts (showing a rail) must not replay it.
document.documentElement.classList.add('is-launching');
window.setTimeout(() => document.documentElement.classList.remove('is-launching'), 700);

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
