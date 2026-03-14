import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../assets/css/tailwind.css';
import '../assets/css/fonts.css';
import '../assets/css/flow.css';

const container = document.getElementById('app');

if (container) {
  try {
    const root = createRoot(container);
    root.render(React.createElement(App));
  } catch (error) {
    console.error('Failed to initialize params page:', error);
    container.innerText = 'Unable to initialize parameters page';
  }
}

if (module.hot) module.hot.accept();
