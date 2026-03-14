import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const additionalStyle = `.list-item-active svg { visibility: visible }`;

export default function (rootElement) {
  const appRoot = document.createElement('div');
  appRoot.setAttribute('id', 'app');

  const style = document.createElement('style');
  style.textContent = additionalStyle;

  rootElement.shadowRoot.appendChild(style);
  rootElement.shadowRoot.appendChild(appRoot);

  const root = createRoot(appRoot);
  root.render(React.createElement(App, { rootElement }));
}
