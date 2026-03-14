import RendererWorkflowService from '@/service/renderer/RendererWorkflowService';
import { debounce, parseJSON } from '@/utils/helper';
import { sendMessage } from '@/utils/message';
import workflowParameters from '@business/parameters';
import cloneDeep from 'lodash.clonedeep';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
};

const os = navigator.appVersion.includes('Mac') ? 'mac' : 'win';
const additionalStyles = `
  .cp-backdrop{position:fixed;top:0;left:0;height:100%;width:100%;background:rgba(0,0,0,.5);padding:1rem;color:#111;z-index:99999999}
  .cp-card{position:absolute;left:50%;top:50px;transform:translateX(-50%);width:100%;max-width:48rem;background:#fff;border-radius:.75rem;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .cp-head{padding:1rem}
  .cp-search{display:flex;height:3rem;align-items:center;border-radius:.5rem;padding:0 .5rem;background:#f3f4f6}
  .cp-input{height:100%;flex:1;border:0;outline:0;background:transparent;padding:0 .5rem}
  .cp-key{margin-left:.25rem;display:inline-block;border:2px solid #d1d5db;border-radius:.375rem;padding:.25rem;font-size:.75rem;font-weight:600;min-width:29px;text-align:center;color:#4b5563}
  .cp-list-wrap{max-height:calc(100vh - 200px);overflow:auto;padding:0 1rem 1rem}
  .cp-item{display:flex;align-items:center;padding:.6rem;border-radius:.5rem;cursor:pointer}
  .cp-item.active{background:#f3f4f6}
  .cp-icon{width:26px;height:26px;border-radius:.375rem;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:11px;color:#555}
  .cp-body{margin:0 .5rem;flex:1;overflow:hidden}
  .cp-name,.cp-desc{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cp-desc{font-size:.875rem;color:#6b7280}
  .cp-footer{display:flex;align-items:center;padding:.5rem 1rem;border-top:1px solid #e5e7eb}
  .cp-open{cursor:pointer;color:#4b5563}
  .cp-grow{flex:1}
  .cp-btn{border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:.5rem;padding:.4rem .8rem;cursor:pointer}
  .cp-empty,.cp-loading{text-align:center;color:#6b7280;padding:.5rem}
  .cp-param-item{margin-bottom:1rem}
  .cp-label{display:block;margin-bottom:.35rem;font-size:.9rem}
  .cp-field{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:.5rem;padding:.5rem .75rem}
  .cp-help{margin:.35rem 0 0 .25rem;font-size:.875rem;color:#6b7280}
`;

function getReadableShortcut(str) {
  const list = {
    option: { win: 'alt', mac: 'option' },
    mod: { win: 'ctrl', mac: '⌘' },
  };
  const regex = /option|mod/g;
  return str.replace(regex, (match) => list[match][os]);
}

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

export default function CommandPaletteApp({ rootElement }) {
  const [paramsList, setParamsList] = useState(defaultParamsList);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(false);
  const [retrieved, setRetrieved] = useState(false);
  const [shortcutKeys, setShortcutKeys] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [workflows, setWorkflows] = useState([]);
  const [paramsActive, setParamsActive] = useState(false);
  const [paramItems, setParamItems] = useState([]);
  const [paramWorkflow, setParamWorkflow] = useState({});
  const inputRef = useRef(null);

  const filteredWorkflows = useMemo(
    () =>
      workflows.filter((workflow) =>
        workflow.name?.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      ),
    [query, workflows]
  );

  const clearParamsState = useCallback(() => {
    setParamItems([]);
    setParamWorkflow({});
    setParamsActive(false);
  }, []);

  const sendExecuteCommand = useCallback((workflow, options = {}) => {
    const workflowData = {
      ...workflow,
      includeTabId: true,
      options: { ...options, checkParams: false },
    };
    RendererWorkflowService.executeWorkflow(workflowData);
    setActive(false);
  }, []);

  const executeWorkflow = useCallback(
    (workflow) => {
      if (!workflow) return;

      let triggerData = workflow.trigger;
      if (!triggerData) {
        const triggerNode = workflow.drawflow?.nodes?.find(
          (node) => node.label === 'trigger'
        );
        triggerData = triggerNode?.data;
      }

      if (triggerData?.parameters?.length > 0) {
        const parameters = cloneDeep(triggerData.parameters).map((item) => ({
          ...item,
          value: item.defaultValue,
        }));

        setParamWorkflow(workflow);
        setParamItems(parameters);
        setParamsActive(true);
      } else {
        sendExecuteCommand(workflow);
      }

      if (inputRef.current) inputRef.current.value = '';
      setQuery('');
    },
    [sendExecuteCommand]
  );

  const executeWorkflowWithParams = useCallback(() => {
    const variables = getParamsValues(paramItems, paramsList);
    sendExecuteCommand(paramWorkflow, { data: { variables } });
    clearParamsState();
  }, [clearParamsState, paramItems, paramWorkflow, paramsList, sendExecuteCommand]);

  const openDashboard = useCallback(() => {
    sendMessage('open:dashboard', '', 'background');
  }, []);

  useEffect(() => {
    const onKeydown = (event) => {
      const { ctrlKey, altKey, metaKey, key, shiftKey } = event;

      if (key === 'Escape') {
        if (paramsActive) clearParamsState();
        else setActive(false);
        return;
      }

      const shortcuts = window._automaShortcuts;
      if (!shortcuts || shortcuts.length < 1) return;

      const automaShortcut = shortcuts.every((shortcutKey) => {
        if (shortcutKey === 'mod') return ctrlKey || metaKey;
        if (shortcutKey === 'shift') return shiftKey;
        if (shortcutKey === 'option') return altKey;
        return shortcutKey === key.toLowerCase();
      });

      if (automaShortcut) {
        event.preventDefault();
        setActive(true);
        setShortcutKeys(shortcuts);
      }
    };

    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [clearParamsState, paramsActive]);

  useEffect(() => {
    if (!active) {
      clearParamsState();
      setQuery('');
      setSelectedIndex(-1);
      return;
    }

    if (!retrieved) {
      browser.storage.local
        .get(['workflows', 'workflowHosts', 'teamWorkflows'])
        .then(({ workflows: localWorkflows, workflowHosts, teamWorkflows }) => {
          setWorkflows([
            ...Object.values(workflowHosts || {}),
            ...Object.values(localWorkflows || {}),
            ...Object.values(Object.values(teamWorkflows || {})[0] || {}),
          ]);
          setRetrieved(true);
        })
        .catch((error) => {
          console.error(error);
          setRetrieved(true);
        });
    }
  }, [active, clearParamsState, retrieved]);

  useEffect(() => {
    if (!active || !inputRef.current) return;
    inputRef.current.focus();
  }, [active, paramsActive]);

  useEffect(() => {
    const syncSelected = debounce((activeIndex) => {
      if (!rootElement?.shadowRoot) return;
      const container = rootElement.shadowRoot.querySelector(
        '#workflows-container .workflows-list'
      );
      const element = rootElement.shadowRoot.querySelector(`#list-item-${activeIndex}`);
      if (!container || !element) return;

      const cTop = container.scrollTop;
      const cBottom = cTop + container.clientHeight;
      const eTop = element.offsetTop;
      const eBottom = eTop + element.clientHeight;

      const inView = eTop >= cTop && eBottom <= cBottom;
      if (!inView) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 100);

    syncSelected(selectedIndex);
  }, [rootElement, selectedIndex]);

  useEffect(() => {
    browser.storage.local.get('automaShortcut').then(({ automaShortcut }) => {
      if (Array.isArray(automaShortcut) && automaShortcut.length < 1) return;
      let keys = ['mod', 'shift', 'e'];
      if (automaShortcut) keys = automaShortcut.split('+');
      setShortcutKeys(keys);
      window._automaShortcuts = keys;
    });

    setParamsList((prev) => ({ ...prev, ...workflowParameters() }));

    window.initPaletteParams = (data) => {
      setParamItems(data.params);
      setParamWorkflow(data.workflow);
      setParamsActive(true);
      setActive(true);
    };

    return () => {
      delete window.initPaletteParams;
    };
  }, []);

  const onInputKeydown = (event) => {
    const { key } = event;

    if (key !== 'Escape') event.stopPropagation();

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const maxIndex = filteredWorkflows.length - 1;
      let nextIndex = selectedIndex;
      if (key === 'ArrowDown') {
        nextIndex += 1;
        if (nextIndex > maxIndex) nextIndex = 0;
      } else {
        nextIndex -= 1;
        if (nextIndex < 0) nextIndex = maxIndex;
      }
      setSelectedIndex(nextIndex);
      return;
    }

    if (key === 'Enter' && !paramsActive) {
      executeWorkflow(filteredWorkflows[selectedIndex]);
    }
  };

  const logoUrl = browser.runtime.getURL(
    process.env.NODE_ENV === 'development' ? '/icon-dev-128.png' : '/icon-128.png'
  );

  if (!active) return null;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('style', null, additionalStyles),
    React.createElement(
      'div',
      {
        className: 'cp-backdrop',
        onClick: (event) => {
          if (event.target === event.currentTarget) setActive(false);
        },
      },
      React.createElement(
        'div',
        { id: 'workflows-container', className: 'cp-card' },
        React.createElement(
          'div',
          { className: 'cp-head' },
          React.createElement(
            'label',
            { className: 'cp-search' },
            React.createElement('img', { src: logoUrl, className: 'h-8 w-8', alt: 'Automa' }),
            React.createElement('input', {
              ref: inputRef,
              type: 'text',
              className: 'cp-input',
              placeholder: paramsActive
                ? paramWorkflow.name
                : 'Search workflows...',
              onInput: (event) => {
                if (paramsActive) return;
                setQuery(event.target.value);
              },
              onKeyDown: onInputKeydown,
            }),
            ...shortcutKeys.map((key) =>
              React.createElement(
                'span',
                { className: 'cp-key', key },
                getReadableShortcut(key)
              )
            )
          )
        ),
        React.createElement(
          'div',
          { className: 'cp-list-wrap workflows-list' },
          !retrieved
            ? React.createElement('div', { className: 'cp-loading' }, 'Loading...')
            : paramsActive
              ? React.createElement(
                  'ul',
                  { className: 'space-y-4 divide-y' },
                  ...paramItems.map((param, paramIdx) =>
                    React.createElement(
                      'li',
                      { key: `${param.name}-${paramIdx}`, className: 'cp-param-item' },
                      React.createElement(
                        'label',
                        { className: 'cp-label' },
                        param.name
                      ),
                      param.type === 'json'
                        ? React.createElement('textarea', {
                            className: 'cp-field',
                            rows: 3,
                            value: param.value ?? '',
                            placeholder: param.placeholder || '',
                            onChange: (event) => {
                              const value = event.target.value;
                              setParamItems((prev) =>
                                prev.map((item, idx) =>
                                  idx === paramIdx ? { ...item, value } : item
                                )
                              );
                            },
                          })
                        : React.createElement('input', {
                            className: 'cp-field',
                            type: param.inputType || param.type || 'text',
                            value: param.value ?? '',
                            placeholder: param.placeholder || '',
                            onChange: (event) => {
                              const value = event.target.value;
                              setParamItems((prev) =>
                                prev.map((item, idx) =>
                                  idx === paramIdx ? { ...item, value } : item
                                )
                              );
                            },
                          }),
                      param.description
                        ? React.createElement(
                            'p',
                            { className: 'cp-help' },
                            param.description
                          )
                        : null
                    )
                  )
                )
              : filteredWorkflows.length === 0 && query
                ? React.createElement('p', { className: 'cp-empty' }, "Can't find workflows")
                : React.createElement(
                    'div',
                    null,
                    ...filteredWorkflows.map((workflow, index) =>
                      React.createElement(
                        'div',
                        {
                          key: workflow.id || `${workflow.name}-${index}`,
                          id: `list-item-${index}`,
                          className: `cp-item ${index === selectedIndex ? 'active' : ''}`,
                          onMouseEnter: () => setSelectedIndex(index),
                          onClick: () => executeWorkflow(workflow),
                        },
                        workflow.icon?.startsWith('http')
                          ? React.createElement('img', {
                              src: workflow.icon,
                              className: 'cp-icon',
                              alt: '',
                            })
                          : React.createElement('div', { className: 'cp-icon' }, 'icon'),
                        React.createElement(
                          'div',
                          { className: 'cp-body' },
                          React.createElement('p', { className: 'cp-name' }, workflow.name),
                          React.createElement(
                            'p',
                            { className: 'cp-desc' },
                            workflow.description
                          )
                        ),
                        React.createElement('span', null, '↵')
                      )
                    )
                  )
        ),
        React.createElement(
          'div',
          { className: 'cp-footer' },
          paramsActive
            ? React.createElement(
                'div',
                { style: { color: '#6b7280' } },
                `${paramWorkflow.description || ''} Press Escape to cancel`
              )
            : React.createElement(
                'p',
                { className: 'cp-open', onClick: openDashboard },
                'Open dashboard'
              ),
          React.createElement('div', { className: 'cp-grow' }),
          paramsActive
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'cp-btn',
                  onClick: executeWorkflowWithParams,
                },
                'Execute'
              )
            : null
        )
      )
    )
  );
}
