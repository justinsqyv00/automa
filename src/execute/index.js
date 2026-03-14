import { parseJSON } from '@/utils/helper';
import { sendMessage } from '@/utils/message';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Browser from 'webextension-polyfill';

function getWorkflowDetail() {
  let hash = window.location.hash.slice(1);
  if (!hash.startsWith('/')) hash = `/${hash}`;

  const { pathname, searchParams } = new URL(window.location.origin + hash);

  const variables = {};
  const { 1: workflowId } = pathname.split('/');

  searchParams.forEach((key, value) => {
    const varValue = parseJSON(decodeURIComponent(value), '##_empty');
    if (varValue === '##_empty') return;

    variables[key] = varValue;
  });

  return { workflowId: workflowId ?? '', variables };
}

function ExecuteApp() {
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    (async () => {
      try {
        const { workflowId, variables } = getWorkflowDetail();
        if (!workflowId) {
          setMessage('Invalid path');
          return;
        }

        const { workflows } = await Browser.storage.local.get('workflows');

        let workflow = workflows[workflowId];
        if (!workflow && Array.isArray(workflows)) {
          workflow = workflows.find((item) => item.id === workflowId);
        }

        if (!workflow) {
          setMessage('Workflow not found');
          return;
        }

        const hasVariables = Object.keys(variables).length > 0;

        setMessage('Executing workflow');

        sendMessage(
          'workflow:execute',
          {
            ...workflow,
            options: { checkParam: !hasVariables, data: { variables } },
          },
          'background'
        ).then(() => {
          setTimeout(window.close, 1000);
        });
      } catch (error) {
        console.error(error);
        setMessage('Unable to execute workflow');
      }
    })();
  }, []);

  return React.createElement('div', { className: 'p-4' }, message);
}

const container = document.getElementById('app');

if (container) {
  const root = createRoot(container);
  root.render(React.createElement(ExecuteApp));
} else {
  console.error('Missing #app container for execute page');
}
