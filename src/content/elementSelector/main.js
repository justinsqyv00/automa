import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@/assets/css/tailwind.css';

export default function (rootElement) {
  const appRoot = document.createElement('div');
  appRoot.setAttribute('id', 'app');

  rootElement.shadowRoot.appendChild(appRoot);

  const root = createRoot(appRoot);
  root.render(React.createElement(App, { rootElement }));
}
