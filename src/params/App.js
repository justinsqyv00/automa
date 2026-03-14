import dayjs from '@/lib/dayjs';
import { parseJSON } from '@/utils/helper';
import automa from '@business';
import workflowParameters from '@business/parameters';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';

const defaultParamsList = {
  string: {
    id: 'string',
    name: 'Input (string)',
  },
  json: {
    id: 'json',
    name: 'Input (JSON)',
  },
  checkbox: {
    id: 'checkbox',
    name: 'Checkbox',
    data: {
      required: false,
    },
  },
};

const flattenTeamWorkflows = (items) => {
  if (!items || typeof items !== 'object') return [];

  const [firstTeam] = Object.values(items);
  return firstTeam && typeof firstTeam === 'object' ? Object.values(firstTeam) : [];
};

function getParamsValues(params, paramsList) {
  const getParamVal = {
    string: (str) => str,
    number: (num) => (Number.isNaN(+num) ? 0 : +num),
    json: (value) => parseJSON(value, null),
    default: (value) => value,
  };

  return params.reduce((acc, param) => {
    const valueFunc =
      getParamVal[param.type] ||
      paramsList[param.type]?.getValue ||
      getParamVal.default;
    const value = valueFunc(param.value || param.defaultValue);
    acc[param.name] = value;

    return acc;
  }, {});
}

function isValidParams(params) {
  return params.every((param) => {
    if (!param.data?.required) return true;

    return Boolean(param.value);
  });
}

function getWorkflowKey(workflow) {
  const workflowId = workflow.data?.id || workflow.data?.promptId || 'workflow';
  return `${workflowId}-${workflow.addedDate}`;
}

export default function ParamsApp() {
  const [retrieved, setRetrieved] = useState(false);
  const [workflows, setWorkflows] = useState([]);
  const [paramsList, setParamsList] = useState(defaultParamsList);
  const checkTimeoutRef = useRef(null);
  const workflowsRef = useRef([]);

  const sortedWorkflows = useMemo(
    () => workflows.slice().sort((a, b) => b.addedDate - a.addedDate),
    [workflows]
  );

  const removeWorkflow = useCallback((workflowKey) => {
    setWorkflows((prev) => {
      const next = prev.filter((item) => getWorkflowKey(item) !== workflowKey);
      workflowsRef.current = next;
      if (next.length === 0) window.close();
      return next;
    });
  }, []);

  const cancelParamBlock = useCallback(
    (workflow, message) => {
      browser.storage.local
        .set({
          [workflow.data.promptId]: {
            message,
            $isError: true,
          },
        })
        .then(() => {
          removeWorkflow(getWorkflowKey(workflow));
        });
    },
    [removeWorkflow]
  );

  const continueWorkflow = useCallback(
    (workflow) => {
      if (!isValidParams(workflow.params)) return;

      const timeout =
        workflow.data.timeoutMs > 0 ? Date.now() > workflow.data.timeout : false;

      browser.storage.local
        .set({
          [workflow.data.promptId]: timeout
            ? { $timeout: true }
            : getParamsValues(workflow.params, paramsList),
        })
        .then(() => {
          removeWorkflow(getWorkflowKey(workflow));
        });
    },
    [paramsList, removeWorkflow]
  );

  const findWorkflow = useCallback(async (workflowId) => {
    if (!workflowId) return null;

    if (workflowId.startsWith('hosted')) {
      const { workflowHosts } = await browser.storage.local.get('workflowHosts');
      if (!workflowHosts) return null;
      const hostId = workflowId.split(':')[1];
      return workflowHosts[hostId] || undefined;
    }

    if (workflowId.startsWith('team')) {
      const { teamWorkflows } = await browser.storage.local.get('teamWorkflows');
      if (!teamWorkflows) return null;

      const teamWorkflowsArr = flattenTeamWorkflows(teamWorkflows);
      return teamWorkflowsArr.find((item) => item.id === workflowId);
    }

    const { workflows: localWorkflows, workflowHosts } =
      await browser.storage.local.get(['workflows', 'workflowHosts']);
    let workflow = Array.isArray(localWorkflows)
      ? localWorkflows.find(({ id }) => id === workflowId)
      : localWorkflows?.[workflowId];

    if (!workflow) {
      workflow = Object.values(workflowHosts || {}).find(
        ({ hostId }) => hostId === workflowId
      );

      if (workflow) workflow.id = workflow.hostId;
    }

    return workflow;
  }, []);

  const addWorkflow = useCallback(
    async (workflowId) => {
      try {
        const workflow =
          typeof workflowId === 'string'
            ? await findWorkflow(workflowId)
            : workflowId;
        if (!workflow?.drawflow?.nodes) {
          console.warn(
            `Skip params workflow (${workflowId || workflow?.id || 'unknown'}): invalid drawflow data`
          );
          return;
        }

        const triggerBlock = workflow.drawflow.nodes.find(
          (node) => node.label === 'trigger'
        );
        if (!triggerBlock?.data?.parameters) {
          console.warn(
            `Skip params workflow (${workflow.id || workflowId || 'unknown'}): missing trigger parameters`
          );
          return;
        }

        const params = triggerBlock.data.parameters.map((param) => ({
          ...param,
          value: param.defaultValue,
          inputType: param.type === 'string' ? 'text' : 'number',
        }));

        setWorkflows((prev) => [
          ...prev,
          {
            params,
            data: workflow,
            addedDate: Date.now(),
          },
        ]);
      } catch (error) {
        console.error(error);
      }
    },
    [findWorkflow]
  );

  const runWorkflow = useCallback(
    (workflow) => {
      if (!isValidParams(workflow.params)) return;

      const variables = getParamsValues(workflow.params, paramsList);
      let payload = {
        name: 'background--workflow:execute',
        data: {
          ...workflow.data,
          options: {
            checkParams: false,
            data: { variables },
          },
        },
      };
      const isFirefox = BROWSER_TYPE === 'firefox';
      payload = isFirefox ? JSON.stringify(payload) : payload;

      browser.runtime
        .sendMessage(payload)
        .then(() => {
          removeWorkflow(getWorkflowKey(workflow));
        })
        .catch((error) => {
          console.error(error);
        });
    },
    [paramsList, removeWorkflow]
  );

  const updateParamValue = useCallback((targetWorkflowKey, paramIndex, nextValue) => {
    setWorkflows((prev) =>
      prev.map((workflow) => {
        if (getWorkflowKey(workflow) !== targetWorkflowKey) return workflow;

        const params = workflow.params.map((param, index) =>
          index === paramIndex ? { ...param, value: nextValue } : param
        );

        return { ...workflow, params };
      })
    );
  }, []);

  useEffect(() => {
    const onMessage = ({ name, data }) => {
      if (name === 'workflow:params') {
        addWorkflow(data);
      } else if (name === 'workflow:params-block') {
        const params = [...data.params];
        delete data.params;

        setWorkflows((prev) => [
          ...prev,
          {
            data,
            params,
            type: 'block',
            addedDate: Date.now(),
          },
        ]);
      }
    };

    browser.runtime.onMessage.addListener(onMessage);

    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [addWorkflow]);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  useEffect(() => {
    const hasBlockWorkflow = workflows.some((workflow) => workflow.type === 'block');
    if (!hasBlockWorkflow) {
      if (checkTimeoutRef.current) {
        clearInterval(checkTimeoutRef.current);
        checkTimeoutRef.current = null;
      }
      return;
    }

    if (!checkTimeoutRef.current) {
      checkTimeoutRef.current = setInterval(() => {
        workflowsRef.current.forEach((workflow) => {
          if (
            workflow.type !== 'block' ||
            Date.now() < workflow.data.timeout ||
            workflow.data.timeoutMs <= 0
          )
            return;

          cancelParamBlock(workflow, 'Timeout');
        });
      }, 1000);
    }

    return () => {
      if (checkTimeoutRef.current) {
        clearInterval(checkTimeoutRef.current);
        checkTimeoutRef.current = null;
      }
    };
  }, [cancelParamBlock, workflows]);

  useEffect(() => {
    (async () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const workflowId = query.get('workflowId');
        if (workflowId) await addWorkflow(workflowId);
        await automa('content');

        setParamsList((prev) => ({
          ...prev,
          ...workflowParameters(),
        }));
      } catch (error) {
        console.error(error);
      } finally {
        setRetrieved(true);
      }
    })();
  }, [addWorkflow]);

  if (!retrieved) {
    return React.createElement(
      'div',
      { className: 'params-loading', 'aria-live': 'polite' },
      'Loading...'
    );
  }

  const logoUrl = browser.runtime.getURL('/icon-128.png');

  return React.createElement(
    'div',
    { className: 'params-root' },
    React.createElement(
      'nav',
      { className: 'params-nav' },
      React.createElement('img', {
        src: logoUrl,
        className: 'params-logo',
        alt: 'Automa',
      }),
      React.createElement('p', { className: 'params-title' }, 'Automa')
    ),
    React.createElement(
      'div',
      { className: 'params-content' },
      React.createElement(
        'p',
        { className: 'params-description' },
        'Input these workflows parameters before it runs.'
      ),
      ...sortedWorkflows.map((workflow) => {
        const workflowName = workflow.data?.name || 'Unnamed workflow';
        const workflowDescription = workflow.data?.description || '';
        const isBlock = workflow.type === 'block';
        const workflowKey = getWorkflowKey(workflow);

        return React.createElement(
          'section',
          {
            key: workflowKey,
            className: 'params-card',
          },
          React.createElement(
            'header',
            { className: 'params-card-header' },
            React.createElement(
              'p',
              { className: 'params-workflow-name' },
              workflowName
            ),
            React.createElement(
              'p',
              { className: 'params-workflow-description' },
              workflowDescription
            )
          ),
          isBlock
            ? React.createElement(
                'p',
                { className: 'params-block-note' },
                'By Parameter Prompt block'
              )
            : null,
          React.createElement(
            'div',
            { className: 'params-list' },
            ...workflow.params.map((param, paramIndex) => {
              const label = `${param.name}${param.data?.required ? '*' : ''}`;
              const fieldId = `param-${workflowKey}-${paramIndex}`;
              const onParamChange = (event) => {
                updateParamValue(
                  workflowKey,
                  paramIndex,
                  param.type === 'checkbox'
                    ? event.target.checked
                    : event.target.value
                );
              };

              let inputEl;
              if (param.type === 'checkbox') {
                inputEl = React.createElement(
                  'label',
                  { className: 'params-checkbox-label' },
                  React.createElement('input', {
                    id: fieldId,
                    type: 'checkbox',
                    checked: Boolean(param.value),
                    onChange: onParamChange,
                  }),
                  React.createElement('span', null, label)
                );
              } else if (param.type === 'json') {
                inputEl = React.createElement('textarea', {
                  id: fieldId,
                  className: 'params-input',
                  placeholder: param.placeholder || '',
                  onChange: onParamChange,
                  value: param.value ?? '',
                  rows: 3,
                });
              } else {
                inputEl = React.createElement('input', {
                  id: fieldId,
                  className: 'params-input',
                  placeholder: param.placeholder || '',
                  onChange: onParamChange,
                  value: param.value ?? '',
                  type: param.inputType || 'text',
                });
              }

              return React.createElement(
                'div',
                { className: 'params-item', key: `${param.name}-${paramIndex}` },
                param.type === 'checkbox'
                  ? inputEl
                  : React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(
                        'label',
                        { className: 'params-label', htmlFor: fieldId },
                        label
                      ),
                      inputEl
                    ),
                param.description
                  ? React.createElement(
                      'p',
                      { className: 'params-help' },
                      param.description
                    )
                  : null
              );
            }),
            React.createElement(
              'div',
              { className: 'params-actions' },
              React.createElement(
                'p',
                { className: 'params-time' },
                dayjs(workflow.addedDate).fromNow()
              ),
              React.createElement(
                'div',
                { className: 'params-spacer' }
              ),
              isBlock
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'params-btn',
                        onClick: () => cancelParamBlock(workflow, 'Canceled'),
                      },
                      'Cancel'
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'params-btn params-btn-primary',
                        disabled: !isValidParams(workflow.params),
                        onClick: () => continueWorkflow(workflow),
                      },
                      'Continue'
                    )
                  )
                : React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'params-btn',
                        onClick: () => removeWorkflow(workflowKey),
                      },
                      'Cancel'
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'params-btn params-btn-primary',
                        disabled: !isValidParams(workflow.params),
                        onClick: () => runWorkflow(workflow),
                      },
                      'Run'
                    )
                  )
            )
          )
        );
      })
    )
  );
}
