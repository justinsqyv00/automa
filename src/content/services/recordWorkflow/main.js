import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import injectAppStyles from '../../injectAppStyles';

const customCSS = `
  #app {
    font-family: 'Inter var';
    line-height: 1.5;
  }
  .content {
    width: 250px;
  }
`;

export default function () {
  const rootElement = document.createElement('div');
  rootElement.attachShadow({ mode: 'open' });
  rootElement.setAttribute('id', 'automa-recording');
  rootElement.classList.add('automa-element-selector');
  document.body.appendChild(rootElement);

  return injectAppStyles(rootElement.shadowRoot, customCSS).then(() => {
    const appRoot = document.createElement('div');
    appRoot.setAttribute('id', 'app');
    rootElement.shadowRoot.appendChild(appRoot);

    const root = createRoot(appRoot);
    root.render(React.createElement(App));

    return root;
  });
}
