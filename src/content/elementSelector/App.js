import findSelector from '@/lib/findSelector';
import FindElement from '@/utils/FindElement';
import { debounce } from '@/utils/helper';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';
import { getElementRect } from '../utils';
import getSelectorOptions from './getSelectorOptions';

let connectedPort = null;
const originalFontSize = document.documentElement.style.fontSize;
const selectedElement = {
  path: [],
  pathIndex: 0,
  cache: new WeakMap(),
};
const MAX_OVERLAY_ELEMENTS = 30;

const baseStyle = `
  .es-root{font-size:16px;z-index:99999;line-height:1.5!important;font-family:'Inter var',sans-serif;font-feature-settings:'cv02','cv03','cv04','cv11'}
  .es-container{pointer-events:none;position:fixed;top:0;left:0;height:100%;width:100%;color:#111}
  .es-container.backdrop{background:rgba(0,0,0,.3)}
  .es-card{pointer-events:auto;position:relative;z-index:50;width:320px;border-radius:.75rem;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .es-drag{position:absolute;z-index:50;top:-15px;left:-15px;display:flex;align-items:center;justify-content:center;border:0;border-radius:.5rem;background:#fff;padding:.5rem;box-shadow:0 10px 20px rgba(0,0,0,.2);cursor:move}
  .es-head{display:flex;align-items:center;padding:1rem 1rem 0}
  .es-grow{flex-grow:1}
  .es-icon-btn{border:0;background:transparent;border-radius:.5rem;padding:.25rem;cursor:pointer}
  .es-body{padding:1rem}
  .es-row{display:flex;gap:.5rem;align-items:center}
  .es-input,.es-select,.es-textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:.5rem;padding:.5rem .75rem}
  .es-checkbox{display:flex;gap:.5rem;align-items:center;font-size:.9rem}
  .es-btn{border:0;border-radius:.5rem;padding:.5rem .75rem;cursor:pointer}
  .es-btn.accent{background:#6366f1;color:#fff}
  .es-btn:disabled{opacity:.7;pointer-events:none}
  .es-muted{font-size:.85rem;color:#6b7280}
  .es-kbd{background:#f3f4f6;border-radius:.35rem;padding:.1rem .35rem}
  .es-settings{margin-top:1rem;padding-top:1rem;border-top:1px solid #e5e7eb}
  .es-overlay{position:fixed;border:2px solid #6366f1;background:rgba(99,102,241,.12);pointer-events:none;z-index:99999998}
`;

function clearSelectedListMarkers() {
  const prevSelectedList = document.querySelectorAll('[automa-el-list]');
  prevSelectedList.forEach((element) => {
    element.removeAttribute('automa-el-list');
  });
}

export default function ElementSelectorApp({ rootElement }) {
  const cardEl = useRef(null);
  const isDraggingRef = useRef(false);
  const hoveredElementRef = useRef(null);
  const [cardRect, setCardRect] = useState({ x: 0, y: 0, height: 0, width: 0 });
  const [state, setState] = useState({
    hide: false,
    elSelector: '',
    destroyed: false,
    isDragging: false,
    selectList: false,
    isExecuting: false,
    selectElements: [],
    showSettings: false,
    selectorType: 'css',
    selectedElements: [],
    activeTab: 'attributes',
    isSelectBlockElement: false,
  });
  const [selectorSettings, setSelectorSettings] = useState({
    idName: true,
    tagName: true,
    attr: true,
    className: true,
    attrNames: 'data-testid',
  });

  const updateSelector = useMemo(
    () =>
      debounce((selector, selectorTypeValue) => {
        let frameSelector;
        let elSelector = selector;

        if (selector.includes('|>')) {
          [frameSelector, elSelector] = selector.split(/\|>(.+)/);
        }

        const selectorType =
          selectorTypeValue === 'css' ? 'cssSelector' : 'xpath';

        try {
          if (frameSelector) {
            const frame = FindElement[selectorType]({
              selector: frameSelector,
              multiple: false,
            });
            if (!frame || !['IFRAME', 'FRAME'].includes(frame.tagName)) return;

            const { top, left } = frame.getBoundingClientRect();
            frame.contentWindow?.postMessage(
              {
                selectorType,
                selector: elSelector,
                type: 'automa:find-element',
                frameRect: { top, left },
              },
              '*'
            );
            return;
          }

          const elements = FindElement[selectorType]({
            selector: elSelector,
            multiple: true,
          });
          setState((prev) => ({
            ...prev,
            selectedElements: Array.from(elements || []).map((el) =>
              getElementRect(el, true)
            ),
          }));
        } catch (error) {
          console.error(error);
          setState((prev) => ({ ...prev, selectedElements: [] }));
        }
      }, 200),
    []
  );

  const clearConnectedPort = useCallback(() => {
    connectedPort = null;
    setState((prev) => ({ ...prev, isSelectBlockElement: false }));
  }, []);

  const destroy = useCallback(() => {
    if (rootElement) rootElement.style.display = 'none';

    setState((prev) => ({
      ...prev,
      hide: true,
      destroyed: true,
      activeTab: '',
      elSelector: '',
      isDragging: false,
      isExecuting: false,
      selectedElements: [],
      selectElements: [],
    }));

    clearSelectedListMarkers();
    document.documentElement.style.fontSize = originalFontSize;
  }, [rootElement]);

  const saveSelector = useCallback(() => {
    if (!connectedPort) return;

    connectedPort.postMessage(state.elSelector);
    clearConnectedPort();
    destroy();
  }, [clearConnectedPort, destroy, state.elSelector]);

  const selectElementPath = useCallback(
    (type) => {
      let pathIndex =
        type === 'up'
          ? selectedElement.pathIndex + 1
          : selectedElement.pathIndex - 1;
      let element = selectedElement.path[pathIndex];

      if ((type === 'up' && !element) || element?.tagName === 'BODY') return;

      if (type === 'down' && !element) {
        const previousElement = selectedElement.path[selectedElement.pathIndex];
        const childEl = Array.from(previousElement.children).find(
          (el) => !['STYLE', 'SCRIPT'].includes(el.tagName)
        );
        if (!childEl) return;

        element = childEl;
        selectedElement.path.unshift(childEl);
        pathIndex = 0;
      }

      selectedElement.pathIndex = pathIndex;

      const selector = selectedElement.cache.has(element)
        ? selectedElement.cache.get(element)
        : findSelector(element, getSelectorOptions(selectorSettings));
      if (!selectedElement.cache.has(element)) {
        selectedElement.cache.set(element, selector);
      }

      setState((prev) => ({
        ...prev,
        selectedElements: [getElementRect(element, true)],
        elSelector: selector,
      }));
    },
    [selectorSettings]
  );

  const selectDomElement = useCallback(
    (target) => {
      if (!target || !target.tagName) return;

      const selector = findSelector(target, getSelectorOptions(selectorSettings));
      const elementPath = [];
      let current = target;
      while (current && current.tagName && current.tagName !== 'BODY') {
        elementPath.push(current);
        current = current.parentElement;
      }

      selectedElement.path = elementPath;
      selectedElement.pathIndex = 0;
      selectedElement.cache.set(target, selector);

      if (state.selectList) {
        clearSelectedListMarkers();
        const listElements = Array.from(document.querySelectorAll(selector));
        listElements.forEach((el) => el.setAttribute('automa-el-list', ''));
      }

      setState((prev) => ({
        ...prev,
        elSelector: selector,
        selectedElements: [getElementRect(target, true)],
        selectElements: [target],
      }));
    },
    [selectorSettings, state.selectList]
  );

  useEffect(() => {
    const onConnect = (port) => {
      clearConnectedPort();
      connectedPort = port;
      setState((prev) => ({ ...prev, isSelectBlockElement: true }));
      port.onDisconnect.addListener(clearConnectedPort);
    };

    browser.runtime.onConnect.addListener(onConnect);
    return () => browser.runtime.onConnect.removeListener(onConnect);
  }, [clearConnectedPort]);

  useEffect(() => {
    const onMessage = ({ data }) => {
      if (data.type !== 'automa:selected-elements') return;

      setState((prev) => ({
        ...prev,
        selectedElements: data.elements || [],
      }));
    };

    const onMouseup = () => {
      setState((prev) => (prev.isDragging ? { ...prev, isDragging: false } : prev));
    };

    const onMousemove = ({ clientX, clientY }) => {
      setCardRect((prevRect) => {
        if (!isDraggingRef.current) return prevRect;

        const next = { ...prevRect };
        const height = window.innerHeight;
        const width = document.documentElement.clientWidth;
        let x = clientX;
        let y = clientY;

        if (y < 10) y = 10;
        else if (next.height + y > height) y = height - next.height;

        if (x < 10) x = 10;
        else if (next.width + x > width) x = width - next.width;

        next.x = x;
        next.y = y;
        return next;
      });
    };

    const onVisibilityChange = () => {
      if (!connectedPort || document.visibilityState !== 'hidden') return;
      clearConnectedPort();
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('mouseup', onMouseup);
    window.addEventListener('mousemove', onMousemove);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('mouseup', onMouseup);
      window.removeEventListener('mousemove', onMousemove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clearConnectedPort]);

  useEffect(() => {
    document.body.toggleAttribute('automa-isDragging', state.isDragging);
    isDraggingRef.current = state.isDragging;
  }, [state.isDragging]);

  useEffect(() => {
    browser.storage.local.set({ selectorSettings }).catch((error) => {
      console.error('Failed to save selector settings:', error);
    });
  }, [selectorSettings]);

  useEffect(() => {
    browser.storage.local
      .get('selectorSettings')
      .then((storage) => {
        setSelectorSettings((prev) => ({
          ...prev,
          ...(storage.selectorSettings || {}),
        }));
      })
      .catch((error) => {
        console.error('Failed to read selector settings:', error);
      });

    const observer = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect;
      setCardRect((prev) => ({ ...prev, width, height }));
    });

    if (cardEl.current) {
      observer.observe(cardEl.current);
      setTimeout(() => {
        if (!cardEl.current) return;
        const { height, width } = cardEl.current.getBoundingClientRect();
        setCardRect({
          x: window.innerWidth - (width + 35),
          y: 20,
          width,
          height,
        });
      }, 500);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (state.destroyed || state.hide) return undefined;

    const isTypingElement = (element) =>
      Boolean(element) &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);

    const onClickCapture = (event) => {
      const target = event.target;
      if (!target || cardEl.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      selectDomElement(target);
    };

    const onMousemoveCapture = (event) => {
      const target = event.target;
      if (!target || cardEl.current?.contains(target)) return;
      hoveredElementRef.current = target;
    };

    const onKeydown = (event) => {
      if (event.code !== 'Space') return;

      const activeElement = document.activeElement;
      if (cardEl.current?.contains(activeElement) || isTypingElement(activeElement)) return;

      const target = hoveredElementRef.current;
      if (!target || cardEl.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      selectDomElement(target);
    };

    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('mousemove', onMousemoveCapture, true);
    window.addEventListener('keydown', onKeydown, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('mousemove', onMousemoveCapture, true);
      window.removeEventListener('keydown', onKeydown, true);
    };
  }, [selectDomElement, state.destroyed, state.hide]);

  const overlayRects = useMemo(
    () =>
      (state.selectedElements || [])
        .filter((item) => item && item.highlight !== false)
        .slice(0, MAX_OVERLAY_ELEMENTS),
    [state.selectedElements]
  );

  return React.createElement(
    React.Fragment,
    null,
    React.createElement('style', null, baseStyle),
    React.createElement(
      'div',
      {
        className: `es-root es-container ${!state.hide ? 'backdrop' : ''}`,
      },
      React.createElement(
        'div',
        {
          ref: cardEl,
          className: 'es-card',
          style: {
            transform: `translate(${cardRect.x}px, ${cardRect.y}px)`,
          },
        },
        React.createElement(
          'button',
            {
              type: 'button',
              className: 'es-drag',
              onMouseDown: () => setState((prev) => ({ ...prev, isDragging: true })),
              'aria-label': 'Drag panel',
            title: 'Drag panel',
          },
          '↕'
        ),
        React.createElement(
          'div',
          { className: 'es-head' },
          React.createElement(
            'p',
            { style: { fontSize: '1.125rem', fontWeight: 600 } },
            'Automa'
          ),
          React.createElement('div', { className: 'es-grow' }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'es-icon-btn',
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => {
                setState((prev) => ({ ...prev, hide: !prev.hide }));
                clearConnectedPort();
              },
              'aria-label': state.hide ? 'Show selector' : 'Hide selector',
              title: state.hide ? 'Show selector' : 'Hide selector',
            },
            state.hide ? '👁️‍🗨️' : '👁️'
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'es-icon-btn',
              onMouseDown: (event) => event.preventDefault(),
              onClick: destroy,
              'aria-label': 'Close selector',
              title: 'Close selector',
            },
            '✕'
          )
        ),
        React.createElement(
          'div',
          { className: 'es-body' },
          React.createElement(
            'div',
            { className: 'es-row' },
            React.createElement('input', {
              className: 'es-input',
              value: state.elSelector,
              placeholder:
                state.selectorType === 'css'
                  ? '#app .card .title'
                  : '//div[@class="title"]',
              onChange: (event) => {
                const value = event.target.value;
                setState((prev) => ({ ...prev, elSelector: value }));
                updateSelector(value, state.selectorType);
              },
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'es-btn',
                onClick: () => selectElementPath('up'),
                'aria-label': 'Select parent element',
                title: 'Select parent element',
              },
              '↑'
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'es-btn',
                onClick: () => selectElementPath('down'),
                'aria-label': 'Select child element',
                title: 'Select child element',
              },
              '↓'
            )
          ),
          React.createElement(
            'div',
            { className: 'es-row', style: { marginTop: '.75rem' } },
            React.createElement(
              'label',
              { className: 'es-checkbox' },
              React.createElement('input', {
                type: 'checkbox',
                checked: state.selectList,
                onChange: (event) =>
                  setState((prev) => ({ ...prev, selectList: event.target.checked })),
              }),
              React.createElement('span', null, 'Select list')
            ),
            React.createElement(
              'label',
              { className: 'es-checkbox' },
              React.createElement('span', null, 'Type'),
              React.createElement(
                'select',
                {
                  className: 'es-select',
                  value: state.selectorType,
                  onChange: (event) =>
                    setState((prev) => ({ ...prev, selectorType: event.target.value })),
                },
                React.createElement('option', { value: 'css' }, 'CSS'),
                React.createElement('option', { value: 'xpath' }, 'XPath')
              )
            )
          ),
          state.isSelectBlockElement
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'es-btn accent',
                  style: { marginTop: '1rem', width: '100%' },
                  disabled: !state.elSelector,
                  onClick: saveSelector,
                },
                'Select Element'
              )
            : null,
          React.createElement(
            'p',
            { className: 'es-muted', style: { marginTop: '.75rem' } },
            `Matched elements: ${state.selectedElements.length}`
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'es-btn',
              style: { marginTop: '.5rem' },
              onClick: () =>
                setState((prev) => ({ ...prev, showSettings: !prev.showSettings })),
            },
            state.showSettings ? 'Hide settings' : 'Show settings'
          ),
          state.showSettings
            ? React.createElement(
                'div',
                { className: 'es-settings' },
                React.createElement(
                  'label',
                  { className: 'es-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: selectorSettings.idName,
                    onChange: (event) =>
                      setSelectorSettings((prev) => ({
                        ...prev,
                        idName: event.target.checked,
                      })),
                  }),
                  React.createElement('span', null, 'Include element id')
                ),
                React.createElement(
                  'label',
                  { className: 'es-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: selectorSettings.tagName,
                    onChange: (event) =>
                      setSelectorSettings((prev) => ({
                        ...prev,
                        tagName: event.target.checked,
                      })),
                  }),
                  React.createElement('span', null, 'Include tag name')
                ),
                React.createElement(
                  'label',
                  { className: 'es-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: selectorSettings.className,
                    onChange: (event) =>
                      setSelectorSettings((prev) => ({
                        ...prev,
                        className: event.target.checked,
                      })),
                  }),
                  React.createElement('span', null, 'Include class name')
                ),
                React.createElement(
                  'label',
                  { className: 'es-checkbox' },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: selectorSettings.attr,
                    onChange: (event) =>
                      setSelectorSettings((prev) => ({
                        ...prev,
                        attr: event.target.checked,
                      })),
                  }),
                  React.createElement('span', null, 'Include attributes')
                ),
                selectorSettings.attr
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(
                        'label',
                        {
                          htmlFor: 'automa-attribute-names',
                          className: 'es-muted',
                          style: { display: 'block', marginTop: '.5rem' },
                        },
                        'Attribute names (comma separated)'
                      ),
                      React.createElement('textarea', {
                        id: 'automa-attribute-names',
                        className: 'es-textarea',
                        rows: 2,
                        value: selectorSettings.attrNames,
                        onChange: (event) =>
                          setSelectorSettings((prev) => ({
                            ...prev,
                            attrNames: event.target.value,
                          })),
                      })
                    )
                  : null
              )
            : null,
          React.createElement(
            'p',
            { className: 'es-muted', style: { marginTop: '1rem' } },
            'Click or press ',
            React.createElement('kbd', { className: 'es-kbd' }, 'Space'),
            ' to select an element'
          )
        )
      ),
      ...overlayRects.map((rect, index) =>
        React.createElement('div', {
          key: `${rect.x}-${rect.y}-${index}`,
          className: 'es-overlay',
          style: {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            display: state.hide ? 'none' : 'block',
          },
        })
      )
    )
  );
}
