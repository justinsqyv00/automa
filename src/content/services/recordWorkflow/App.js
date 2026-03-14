import { toCamelCase } from '@/utils/helper';
import { tasks } from '@/utils/shared';
import findSelector from '@/lib/findSelector';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';
import { getElementRect } from '../../utils';
import addBlock from './addBlock';

const mouseRelativePos = { x: 0, y: 0 };
const elementsPath = {
  path: [],
  cache: new WeakMap(),
};

const blocksList = {
  IMG: ['save-assets', 'attribute-value'],
  VIDEO: ['save-assets', 'attribute-value'],
  AUDIO: ['save-assets', 'attribute-value'],
  default: ['get-text', 'attribute-value'],
};

const customStyles = `
  .rw-content { width: 250px; }
  .rw-head { user-select: none; cursor: grab; display: flex; align-items: center; padding: .5rem 1rem; }
  .rw-head.dragging { cursor: grabbing; }
  .rw-stop { height: 24px; width: 24px; border-radius: 999px; border: 0; background: #f87171; color: #fff; cursor: pointer; }
  .rw-grow { flex-grow: 1; }
  .rw-input, .rw-select { width: 100%; border: 0; border-radius: .5rem; padding: .5rem 1rem; background: #f3f4f6; }
  .rw-btn { width: 100%; border: 0; border-radius: .5rem; padding: .5rem 1rem; background: #f3f4f6; cursor: pointer; }
  .rw-btn + .rw-btn { margin-top: .5rem; }
  .rw-btn-accent { background: #6366f1; color: #fff; }
  .rw-btn[disabled] { opacity: .7; pointer-events: none; }
  .rw-icon-btn { border: 0; background: transparent; cursor: pointer; }
  .rw-note { margin-top: 1rem; font-size: 14px; line-height: 1.25; }
  .rw-kbd { background: #f3f4f6; border-radius: .35rem; padding: .15rem .35rem; }
`;

function normalizeAttributes(attributes) {
  if (!attributes) return [];
  if (Array.isArray(attributes)) return attributes;
  return Array.from(attributes);
}

function buildPath(element) {
  const path = [];
  let current = element;
  while (current && current.tagName && current.tagName !== 'BODY') {
    path.push(current);
    current = current.parentElement;
  }
  return path;
}

export default function RecordWorkflowApp() {
  const rootEl = useRef(null);
  const [tempListId, setTempListId] = useState('');
  const [selectState, setSelectState] = useState({
    listId: '',
    list: false,
    pathIndex: 0,
    status: 'idle',
    isInList: false,
    listSelector: '',
    childSelector: '',
    parentSelector: '',
    isSelecting: false,
    selectedElements: [],
  });
  const [draggingState, setDraggingState] = useState({
    yPos: 20,
    dragging: false,
    xPos: window.innerWidth - 300,
  });
  const [addBlockState, setAddBlockState] = useState({
    blocks: [],
    column: '',
    varName: '',
    attributes: [],
    activeAttr: '',
    activeBlock: '',
    workflowColumns: [],
  });

  const resetAddBlockFields = useCallback(() => {
    setAddBlockState((prev) => ({
      ...prev,
      column: '',
      varName: '',
      activeAttr: '',
      activeBlock: '',
    }));
  }, []);

  const stopRecording = useCallback(() => {
    browser.runtime.sendMessage({
      type: 'background--recording:stop',
    });
  }, []);

  const clearSelectState = useCallback(() => {
    setSelectState((prev) => {
      if (prev.list && prev.listId) {
        addBlock({
          id: 'loop-breakpoint',
          description: prev.listId,
          data: { loopId: prev.listId },
        });
      }

      return {
        listId: '',
        list: false,
        pathIndex: 0,
        status: 'idle',
        isInList: false,
        listSelector: '',
        childSelector: '',
        parentSelector: '',
        isSelecting: false,
        selectedElements: [],
      };
    });

    const selectedList = document.querySelectorAll('[automa-el-list]');
    selectedList.forEach((element) => {
      element.removeAttribute('automa-el-list');
    });

    const frameElements = document.querySelectorAll('iframe, frame');
    frameElements.forEach((element) => {
      element.contentWindow?.postMessage(
        {
          type: 'automa:reset-element-selector',
        },
        '*'
      );
    });

    document.body.removeAttribute('automa-selecting');
  }, []);

  const getElementBlocks = useCallback((element) => {
    if (!element) return;

    const blocks = [...(blocksList[element.tagName] || blocksList.default)];
    setAddBlockState((prev) => ({
      ...prev,
      blocks,
      attributes: normalizeAttributes(element.attributes),
    }));
  }, []);

  const onElementsSelected = useCallback(
    ({ selector, elements, path, element }) => {
      if (path) {
        elementsPath.path = path;
      }

      if (element) {
        elementsPath.cache.set(element, selector);
      }

      getElementBlocks(element || path?.[0] || null);
      setSelectState((prev) => {
        let nextSelector = selector;
        let nextState = {
          ...prev,
          selectedElements: elements || [],
          pathIndex: 0,
          parentSelector: '',
        };

        if (prev.list) {
          if (!prev.listSelector) {
            nextState = {
              ...nextState,
              isInList: false,
              listSelector: selector,
              childSelector: selector,
            };

            document.querySelectorAll(selector).forEach((item) => {
              item.setAttribute('automa-el-list', '');
            });

            return nextState;
          }

          nextState.isInList = true;
          nextSelector = selector.replace(prev.listSelector, '').trim();
        }

        nextState.childSelector = nextSelector;
        return nextState;
      });
    },
    [getElementBlocks]
  );

  const addFlowItem = useCallback(() => {
    const saveData = Boolean(addBlockState.column);
    const assignVariable = Boolean(addBlockState.varName);
    const block = {
      id: addBlockState.activeBlock,
      data: {
        saveData,
        assignVariable,
        waitForSelector: true,
        dataColumn: addBlockState.column,
        variableName: addBlockState.varName,
        selector: selectState.list ? selectState.listSelector : selectState.childSelector,
      },
    };

    if (selectState.list) {
      if (selectState.isInList || selectState.listId) {
        const childSelector = selectState.isInList ? selectState.childSelector : '';
        block.data.selector = `{{loopData@${selectState.listId}}} ${childSelector}`;
      } else {
        block.data.multiple = true;
      }
    }

    if (addBlockState.activeBlock === 'attribute-value') {
      block.data.attributeName = addBlockState.activeAttr;
    }

    addBlock(block).then(() => {
      setAddBlockState((prev) => ({
        ...prev,
        column: '',
        varName: '',
        activeAttr: '',
      }));
    });
  }, [addBlockState, selectState]);

  const saveElementListId = useCallback(() => {
    if (!tempListId) return;

    const listId = toCamelCase(tempListId);
    setTempListId('');
    setSelectState((prev) => ({ ...prev, listId }));

    addBlock({
      id: 'loop-data',
      description: listId,
      data: {
        loopThrough: 'elements',
        loopId: listId,
        elementSelector: selectState.listSelector,
      },
    });
  }, [selectState.listSelector, tempListId]);

  const selectElementPath = useCallback(
    (type) => {
      const { pathIndex } = selectState;
      let nextPathIndex = type === 'up' ? pathIndex + 1 : pathIndex - 1;
      let element = elementsPath.path[nextPathIndex];

      if ((type === 'up' && !element) || element?.tagName === 'BODY') return;

      if (type === 'down' && !element) {
        const previousElement = elementsPath.path[pathIndex];
        const childEl = Array.from(previousElement.children).find(
          (el) => !['STYLE', 'SCRIPT'].includes(el.tagName)
        );
        if (!childEl) return;

        element = childEl;
        elementsPath.path.unshift(childEl);
        nextPathIndex = 0;
      }

      const selector = elementsPath.cache.has(element)
        ? elementsPath.cache.get(element)
        : findSelector(element);
      if (!elementsPath.cache.has(element)) {
        elementsPath.cache.set(element, selector);
      }

      setSelectState((prev) => ({
        ...prev,
        pathIndex: nextPathIndex,
        selectedElements: [getElementRect(element)],
        childSelector: selector,
      }));
      getElementBlocks(element);
    },
    [getElementBlocks, selectState]
  );

  const startSelecting = useCallback((list = false) => {
    setSelectState((prev) => ({
      ...prev,
      list,
      isSelecting: true,
      status: 'selecting',
    }));
    document.body.setAttribute('automa-selecting', '');
  }, []);

  const toggleDragging = useCallback((value, event) => {
    if (value) {
      const bounds = rootEl.current?.getBoundingClientRect();
      if (bounds) {
        mouseRelativePos.x = event.clientX - bounds.left;
        mouseRelativePos.y = event.clientY - bounds.top;
      }
    } else {
      mouseRelativePos.x = 0;
      mouseRelativePos.y = 0;
    }

    setDraggingState((prev) => ({ ...prev, dragging: value }));
  }, []);

  useEffect(() => {
    const onMousemove = ({ clientX, clientY }) => {
      setDraggingState((prev) => {
        if (!prev.dragging) return prev;
        return {
          ...prev,
          xPos: clientX - mouseRelativePos.x,
          yPos: clientY - mouseRelativePos.y,
        };
      });
    };

    window.addEventListener('mousemove', onMousemove);
    return () => window.removeEventListener('mousemove', onMousemove);
  }, []);

  useEffect(() => {
    if (!selectState.isSelecting) return undefined;

    const onKeyup = ({ key }) => {
      if (key !== 'Escape') return;
      clearSelectState();
    };

    const onClickCapture = (event) => {
      const element = event.target;
      if (!element || rootEl.current?.contains(element)) return;

      event.preventDefault();
      event.stopPropagation();

      const selector = findSelector(element);
      onElementsSelected({
        selector,
        element,
        path: buildPath(element),
        elements: [getElementRect(element)],
      });
    };

    window.addEventListener('keyup', onKeyup);
    document.addEventListener('click', onClickCapture, true);

    return () => {
      window.removeEventListener('keyup', onKeyup);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [clearSelectState, onElementsSelected, selectState.isSelecting]);

  useEffect(() => {
    resetAddBlockFields();
  }, [resetAddBlockFields, selectState.selectedElements]);

  useEffect(() => {
    browser.storage.local
      .get(['recording', 'workflows'])
      .then(({ recording, workflows }) => {
        const workflow = Object.values(workflows || {}).find(
          ({ id }) => recording?.workflowId === id
        );

        setAddBlockState((prev) => ({
          ...prev,
          workflowColumns: workflow?.table || [],
        }));
      })
      .catch((error) => {
        console.error(
          'Failed to load workflow columns for recording. Some features may not work correctly.',
          error
        );
      });
  }, []);

  const selectedElementExists = selectState.selectedElements.length > 0;
  const canSaveBlock =
    addBlockState.activeBlock &&
    !(
      addBlockState.activeBlock === 'attribute-value' &&
      !addBlockState.activeAttr
    );
  const selectedSelector = selectState.childSelector || selectState.parentSelector || '';
  const showPathControls =
    Boolean(selectedSelector) &&
    !selectState.list &&
    !selectedSelector.includes('|>');
  const shouldAskListId = selectState.list && !selectState.listId;

  const blockOptions = useMemo(
    () =>
      addBlockState.blocks.map((block) =>
        React.createElement(
          'option',
          {
            key: block,
            value: block,
          },
          tasks[block]?.name || block
        )
      ),
    [addBlockState.blocks]
  );

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('style', null, customStyles),
    React.createElement(
      'div',
      {
        ref: rootEl,
        className: 'rw-content fixed top-0 left-0 overflow-hidden rounded-lg bg-white text-black shadow-xl',
        style: {
          zIndex: 99999999,
          fontSize: '16px',
          transform: `translate(${draggingState.xPos}px, ${draggingState.yPos}px)`,
        },
      },
      React.createElement(
        'div',
        {
          className: `rw-head hoverable transition ${draggingState.dragging ? 'dragging' : ''}`,
          onMouseUp: (event) => toggleDragging(false, event),
          onMouseDown: (event) => toggleDragging(true, event),
        },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'rw-stop',
            title: 'Stop recording',
            'aria-label': 'Stop recording',
            onClick: stopRecording,
          },
          '●'
        ),
        React.createElement('p', { className: 'ml-2 font-semibold' }, 'Automa'),
        React.createElement('div', { className: 'rw-grow' }),
        React.createElement(
          'span',
          { role: 'img', 'aria-label': 'Drag to move recording panel' },
          '↕'
        )
      ),
      React.createElement(
        'div',
        { className: 'p-4' },
        selectState.status === 'idle'
          ? React.createElement(
              React.Fragment,
              null,
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'rw-btn',
                  onClick: () => startSelecting(false),
                },
                'Select element'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'rw-btn',
                  onClick: () => startSelecting(true),
                },
                'Select list element'
              )
            )
          : React.createElement(
              'div',
              { className: 'leading-tight' },
              !selectedElementExists
                ? React.createElement('p', null, 'Select an element by clicking on it')
                : shouldAskListId
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(
                        'label',
                        { htmlFor: 'list-id', className: 'ml-1', style: { fontSize: '14px' } },
                        'Element list id'
                      ),
                      React.createElement('input', {
                        id: 'list-id',
                        value: tempListId,
                        placeholder: 'listId',
                        className: 'rw-input',
                        onChange: (event) => setTempListId(event.target.value),
                        onKeyUp: (event) => {
                          if (event.key === 'Enter') saveElementListId();
                        },
                      }),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'rw-btn rw-btn-accent',
                          disabled: !tempListId,
                          onClick: saveElementListId,
                        },
                        'Save'
                      )
                    )
                  : React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(
                        'div',
                        { className: 'flex w-full items-center space-x-2' },
                        React.createElement('input', {
                          value: selectedSelector,
                          className: 'rw-input',
                          readOnly: true,
                        }),
                        showPathControls
                          ? React.createElement(
                              React.Fragment,
                              null,
                              React.createElement(
                                'button',
                                {
                                  type: 'button',
                                  className: 'rw-icon-btn',
                                  onClick: () => selectElementPath('up'),
                                },
                                '↑'
                              ),
                              React.createElement(
                                'button',
                                {
                                  type: 'button',
                                  className: 'rw-icon-btn',
                                  onClick: () => selectElementPath('down'),
                                },
                                '↓'
                              )
                            )
                          : null
                      ),
                      React.createElement(
                        'select',
                        {
                          value: addBlockState.activeBlock,
                          className: 'rw-select mt-2',
                          onChange: (event) =>
                            setAddBlockState((prev) => ({
                              ...prev,
                              activeBlock: event.target.value,
                            })),
                        },
                        React.createElement(
                          'option',
                          { value: '', disabled: true },
                          'Select what to do'
                        ),
                        ...blockOptions
                      ),
                      ['get-text', 'attribute-value'].includes(addBlockState.activeBlock)
                        ? React.createElement(
                            React.Fragment,
                            null,
                            addBlockState.activeBlock === 'attribute-value'
                              ? React.createElement(
                                  'select',
                                  {
                                    value: addBlockState.activeAttr,
                                    className: 'rw-select mt-2',
                                    onChange: (event) =>
                                      setAddBlockState((prev) => ({
                                        ...prev,
                                        activeAttr: event.target.value,
                                      })),
                                  },
                                  React.createElement(
                                    'option',
                                    { value: '', disabled: true },
                                    'Select attribute'
                                  ),
                                  ...addBlockState.attributes.map((item) =>
                                    React.createElement(
                                      'option',
                                      { key: item.name, value: item.name },
                                      `${item.name}(${(item.value || '').slice(0, 64)})`
                                    )
                                  )
                                )
                              : null,
                            React.createElement(
                              'label',
                              {
                                htmlFor: 'variable-name',
                                className: 'ml-2 mt-2 text-sm text-gray-600',
                              },
                              'Assign to variable'
                            ),
                            React.createElement('input', {
                              id: 'variable-name',
                              value: addBlockState.varName,
                              placeholder: 'Variable name',
                              className: 'rw-input',
                              onChange: (event) =>
                                setAddBlockState((prev) => ({
                                  ...prev,
                                  varName: event.target.value,
                                })),
                            }),
                            React.createElement(
                              'label',
                              {
                                htmlFor: 'select-column',
                                className: 'ml-2 mt-2 text-sm text-gray-600',
                              },
                              'Insert to table'
                            ),
                            React.createElement(
                              'select',
                              {
                                id: 'select-column',
                                value: addBlockState.column,
                                className: 'rw-select block',
                                onChange: (event) =>
                                  setAddBlockState((prev) => ({
                                    ...prev,
                                    column: event.target.value,
                                  })),
                              },
                              React.createElement('option', { value: '' }, 'Select column [none]'),
                              ...addBlockState.workflowColumns.map((column) =>
                                React.createElement(
                                  'option',
                                  { key: column.id, value: column.id },
                                  column.name
                                )
                              )
                            )
                          )
                        : null,
                      addBlockState.activeBlock
                        ? React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'rw-btn rw-btn-accent mt-4',
                              disabled: !canSaveBlock,
                              onClick: addFlowItem,
                            },
                            'Save'
                          )
                        : null
                    ),
              React.createElement(
                'p',
                { className: 'rw-note' },
                'Press ',
                React.createElement('kbd', { className: 'rw-kbd' }, 'Esc'),
                ' to cancel'
              )
            )
      )
    )
  );
}
