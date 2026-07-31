(function () {
  'use strict';

  const EXTENSION_BUTTON_ATTR = 'data-x-scheduler-helper-button';
  const MENU_ATTR = 'data-x-scheduler-helper-menu';
  const STORAGE_KEY = 'xSchedulerQuickPresets';
  const FIXED_TIME = '22:40';
  const OBSERVER_RESCAN_DELAY = 250;
  const ELEMENT_WAIT_TIMEOUT = 12000;
  const ELEMENT_WAIT_INTERVAL = 120;
  const PRESET_DATE_FORMAT = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let scheduledScan = null;
  let outsideClickListenerInstalled = false;
  let globalMutationObserver = null;
  let openMenuButton = null;

  function logInfo(message, details) {
    console.log('[X Scheduler Quick Menu]', message, details || '');
  }

  function logError(message, error) {
    console.error('[X Scheduler Quick Menu]', message, error || '');
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (items) => {
        if (chrome.runtime.lastError) {
          logError('Failed to read presets from storage.', chrome.runtime.lastError);
          resolve(undefined);
          return;
        }

        resolve(items[key]);
      });
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          logError('Failed to save presets to storage.', chrome.runtime.lastError);
        }

        resolve();
      });
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => {
        if (chrome.runtime.lastError) {
          logError('Failed to remove presets from storage.', chrome.runtime.lastError);
        }

        resolve();
      });
    });
  }

  function normalizePresetLabel(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();

    const dateTimeMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (dateTimeMatch) {
      const year = Number(dateTimeMatch[1]);
      const month = Number(dateTimeMatch[2]);
      const day = Number(dateTimeMatch[3]);
      const hour = Number(dateTimeMatch[4]);
      const minute = Number(dateTimeMatch[5]);

      if (
        !Number.isNaN(year) && year >= 2000 && year <= 2100 &&
        !Number.isNaN(month) && month >= 1 && month <= 12 &&
        !Number.isNaN(day) && day >= 1 && day <= 31 &&
        !Number.isNaN(hour) && hour >= 0 && hour <= 23 &&
        !Number.isNaN(minute) && minute >= 0 && minute <= 59
      ) {
        return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      }
    }

    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function formatLocalDateTime(date) {
    const dateParts = PRESET_DATE_FORMAT.formatToParts(date);
    const year = dateParts.find((part) => part.type === 'year')?.value || String(date.getFullYear());
    const month = dateParts.find((part) => part.type === 'month')?.value || String(date.getMonth() + 1).padStart(2, '0');
    const day = dateParts.find((part) => part.type === 'day')?.value || String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function parseLocalDateTime(value) {
    const normalized = normalizePresetLabel(value);
    if (!normalized) {
      return null;
    }

    const fullMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (fullMatch) {
      return new Date(
        Number(fullMatch[1]),
        Number(fullMatch[2]) - 1,
        Number(fullMatch[3]),
        Number(fullMatch[4]),
        Number(fullMatch[5]),
        0,
        0
      );
    }

    const timeMatch = normalized.match(/^(\d{2}):(\d{2})$/);
    if (timeMatch) {
      return computeTargetDate(normalized);
    }

    return null;
  }

  function getStoredPresets() {
    return storageGet(STORAGE_KEY).then((presets) => {
      if (!Array.isArray(presets)) {
        return [];
      }

      return Array.from(new Set(presets.map(normalizePresetLabel).filter(Boolean)));
    });
  }

  function savePreset(timeValue) {
    const normalized = normalizePresetLabel(timeValue);
    if (!normalized) {
      return Promise.resolve([]);
    }

    return getStoredPresets().then((presets) => {
      const next = Array.from(new Set([...presets, normalized]));
      next.sort((left, right) => left.localeCompare(right));
      return storageSet(STORAGE_KEY, next).then(() => next);
    });
  }

  function deletePreset(timeValue) {
    const normalized = normalizePresetLabel(timeValue);
    if (!normalized) {
      return Promise.resolve([]);
    }

    return getStoredPresets().then((presets) => {
      const next = presets.filter((preset) => preset !== normalized);
      return storageSet(STORAGE_KEY, next).then(() => next);
    });
  }

  function getNow() {
    return new Date();
  }

  function parseTimeString(timeValue) {
    const normalized = normalizePresetLabel(timeValue);
    if (!normalized) {
      throw new Error(`Invalid time preset: ${timeValue}`);
    }

    const [hourString, minuteString] = normalized.split(':');
    return {
      hour: Number(hourString),
      minute: Number(minuteString)
    };
  }

  function computeTargetDate(timeValue) {
    const { hour, minute } = parseTimeString(timeValue);
    const now = getNow();
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(hour, minute, 0, 0);

    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return target;
  }

  function getFixedMenuLabel() {
    const target = computeTargetDate(FIXED_TIME);
    const now = getNow();
    const dayLabel = target.toDateString() === now.toDateString() ? '今日' : '明日';
    return `${dayLabel}の${FIXED_TIME}に予約`;
  }

  function formatTime(targetDate) {
    return `${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}`;
  }

  function describePreset(presetValue) {
    const normalized = normalizePresetLabel(presetValue);
    if (!normalized) {
      return '保存済みの時間';
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
      const [datePart, timePart] = normalized.split(' ');
      return `${datePart} ${timePart}`;
    }

    return normalized;
  }

  function createNumericField(labelText, min, max, step, defaultValue) {
    const field = document.createElement('label');
    field.className = 'x-scheduler-quick-menu__field';

    const label = document.createElement('span');
    label.className = 'x-scheduler-quick-menu__field-label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.pattern = labelText === '年' ? '\\d{4}' : '\\d{2}';
    input.dataset.min = String(min);
    input.dataset.max = String(max);
    input.dataset.step = String(step);
    input.value = labelText === '年' ? String(defaultValue) : String(defaultValue).padStart(2, '0');
    input.className = 'x-scheduler-quick-menu__field-input';

    field.appendChild(label);
    field.appendChild(input);
    return { field, input };
  }

  function getDefaultPresetParts() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes()
    };
  }

  function buildPresetValueFromInputs(inputs) {
    const parseField = (input, expectedLength) => {
      const value = String(input.value || '').trim();
      if (!/^\d+$/.test(value)) {
        return NaN;
      }

      if (expectedLength && value.length > expectedLength) {
        return NaN;
      }

      return Number(value);
    };

    const year = parseField(inputs.year, 4);
    const month = parseField(inputs.month, 2);
    const day = parseField(inputs.day, 2);
    const hour = parseField(inputs.hour, 2);
    const minute = parseField(inputs.minute, 2);

    if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
      return null;
    }

    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute
    ) {
      return null;
    }

    return formatLocalDateTime(date);
  }

  function dispatchReactChange(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function waitForElement(getter, timeout = ELEMENT_WAIT_TIMEOUT, interval = ELEMENT_WAIT_INTERVAL) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        try {
          const result = getter();
          if (result) {
            resolve(result);
            return;
          }
        } catch (error) {
          reject(error);
          return;
        }

        if (Date.now() - start >= timeout) {
          reject(new Error('Timed out while waiting for element.'));
          return;
        }

        setTimeout(tick, interval);
      };

      tick();
    });
  }

  function clickElement(element) {
    if (!element) {
      return false;
    }

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.click();
    return true;
  }

  function getTweetButtons() {
    return Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
  }

  function removeOrphanedButtons() {
    document.querySelectorAll(`[${EXTENSION_BUTTON_ATTR}]`).forEach((button) => {
      const targetId = button.getAttribute('data-target-button-id');
      if (!targetId) {
        return;
      }

      const target = document.querySelector(`[data-x-scheduler-target-id="${CSS.escape(targetId)}"]`);
      if (!target || !target.isConnected) {
        button.remove();
      }
    });
  }

  function ensureTargetId(button) {
    if (!button.dataset.xSchedulerTargetId) {
      button.dataset.xSchedulerTargetId = `x-scheduler-${Math.random().toString(36).slice(2, 10)}`;
    }

    return button.dataset.xSchedulerTargetId;
  }

  function buildScheduleButton(targetButton) {
    const extensionButton = document.createElement('button');
    extensionButton.type = 'button';
    extensionButton.setAttribute(EXTENSION_BUTTON_ATTR, 'true');
    extensionButton.setAttribute('aria-label', '予約ショートカットを開く');
    extensionButton.dataset.targetButtonId = ensureTargetId(targetButton);
    extensionButton.className = 'x-scheduler-quick-button';
    extensionButton.textContent = '▼';
    extensionButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(extensionButton, targetButton);
    });
    return extensionButton;
  }

  function locateInsertionParent(targetButton) {
    return targetButton.parentElement || targetButton.closest('div[role="group"]') || targetButton.closest('div[style]') || null;
  }

  function ensureInlineRow(targetButton, extensionButton) {
    const parent = targetButton.parentElement;
    if (!parent) {
      return null;
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'x-scheduler-quick-button-row';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';
    wrapper.style.verticalAlign = 'middle';

    parent.insertBefore(wrapper, targetButton);
    wrapper.appendChild(targetButton);
    wrapper.appendChild(extensionButton);
    return wrapper;
  }

  function insertExtensionButton(targetButton) {
    if (!targetButton || !targetButton.isConnected) {
      return;
    }

    const targetId = ensureTargetId(targetButton);
    const existing = document.querySelector(`[${EXTENSION_BUTTON_ATTR}][data-target-button-id="${CSS.escape(targetId)}"]`);
    if (existing) {
      return;
    }

    const parent = locateInsertionParent(targetButton);
    if (!parent) {
      return;
    }

    const button = buildScheduleButton(targetButton);
    ensureInlineRow(targetButton, button);
  }

  function scanForTweetButtons() {
    try {
      removeOrphanedButtons();
      getTweetButtons().forEach(insertExtensionButton);
    } catch (error) {
      logError('Failed to scan tweet buttons.', error);
    }
  }

  function scheduleScan() {
    if (scheduledScan) {
      return;
    }

    scheduledScan = window.setTimeout(() => {
      scheduledScan = null;
      scanForTweetButtons();
    }, OBSERVER_RESCAN_DELAY);
  }

  function getMenu() {
    return document.querySelector(`[${MENU_ATTR}="true"]`);
  }

  function closeMenu() {
    const menu = getMenu();
    if (menu) {
      menu.remove();
    }

    openMenuButton = null;
  }

  function ensureOutsideClickHandler() {
    if (outsideClickListenerInstalled) {
      return;
    }

    document.addEventListener('pointerdown', (event) => {
      const menu = getMenu();
      if (!menu) {
        return;
      }

      const target = event.target;
      if (menu.contains(target) || openMenuButton?.contains(target)) {
        return;
      }

      closeMenu();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    outsideClickListenerInstalled = true;
  }

  function createMenuSectionTitle(text) {
    const title = document.createElement('div');
    title.className = 'x-scheduler-quick-menu__section-title';
    title.textContent = text;
    return title;
  }

  function createMenuItem(label, onClick, options = {}) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'x-scheduler-quick-menu__item';
    item.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (options.closeOnClick !== false) {
        closeMenu();
      }

      await onClick();
    });

    const labelNode = document.createElement('span');
    labelNode.className = 'x-scheduler-quick-menu__item-label';
    labelNode.textContent = label;
    item.appendChild(labelNode);
    return item;
  }

  async function loadPresetsIntoMenu(menu) {
    const list = menu.querySelector('[data-x-scheduler-preset-list="true"]');
    if (!list) {
      return;
    }

    const presets = await getStoredPresets();
    list.innerHTML = '';

    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'x-scheduler-quick-menu__empty';
      empty.textContent = '保存済みの時間はありません';
      list.appendChild(empty);
    } else {
      presets.forEach((preset) => {
        const row = document.createElement('div');
        row.className = 'x-scheduler-quick-menu__preset-row';

        const button = createMenuItem(`🕒 ${describePreset(preset)}`, async () => {
          await runScheduleAutomation(preset);
        });
        button.classList.add('x-scheduler-quick-menu__preset-trigger');

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'x-scheduler-quick-menu__delete';
        deleteButton.setAttribute('aria-label', `${describePreset(preset)} を削除`);
        deleteButton.textContent = '🗑️';
        deleteButton.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await deletePreset(preset);
          await refreshPresetList(menu);
        });

        row.appendChild(button);
        row.appendChild(deleteButton);
        list.appendChild(row);
      });
    }
  }

  function findScheduleModalRoot() {
    const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
    if (modal) {
      return modal;
    }

    return Array.from(document.querySelectorAll('div')).find((element) => {
      return element.querySelectorAll('select').length >= 5;
    }) || null;
  }

  function getSelectNumericValue(select) {
    const selectedOption = select?.selectedOptions?.[0] || null;
    const candidates = [select?.value, selectedOption?.value, selectedOption?.textContent, select?.getAttribute('aria-label')]
      .filter((value) => typeof value === 'string' && value.trim().length > 0);

    for (const candidate of candidates) {
      const numericMatch = candidate.match(/\d{1,4}/);
      if (numericMatch) {
        const number = Number(numericMatch[0]);
        if (!Number.isNaN(number)) {
          return number;
        }
      }
    }

    const direct = Number(select?.value);
    return Number.isNaN(direct) ? NaN : direct;
  }

  function extractPresetFromModal(modal) {
    if (!modal) {
      return null;
    }

    const selects = Array.from(modal.querySelectorAll('select'));
    const mapped = mapScheduleSelects(selects);
    const year = mapped.year ? getSelectNumericValue(mapped.year) : NaN;
    const month = mapped.month ? getSelectNumericValue(mapped.month) : NaN;
    const day = mapped.day ? getSelectNumericValue(mapped.day) : NaN;
    const hour = mapped.hour ? getSelectNumericValue(mapped.hour) : NaN;
    const minute = mapped.minute ? getSelectNumericValue(mapped.minute) : NaN;

    if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
      return null;
    }

    const selectedDate = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (Number.isNaN(selectedDate.getTime())) {
      return null;
    }

    return formatLocalDateTime(selectedDate);
  }

  function getCurrentPresetCandidate() {
    return null;
  }

  function focusComposer() {
    const composer = document.querySelector('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]');
    if (!composer) {
      return;
    }

    composer.focus();
    if (typeof composer.click === 'function') {
      composer.click();
    }
  }

  function buildMenu() {
    const menu = document.createElement('div');
    menu.setAttribute(MENU_ATTR, 'true');
    menu.className = 'x-scheduler-quick-menu';

    const fixedLabel = getFixedMenuLabel();
    const fixedItem = createMenuItem(`⚡ ${fixedLabel}`, async () => {
      await runScheduleAutomation(FIXED_TIME);
    });

    const dividerTop = document.createElement('div');
    dividerTop.className = 'x-scheduler-quick-menu__divider';

    const presetTitle = createMenuSectionTitle('保存済みの時間');

    const editorPanel = document.createElement('div');
    editorPanel.className = 'x-scheduler-quick-menu__editor';

    const editorToggle = document.createElement('button');
    editorToggle.type = 'button';
    editorToggle.className = 'x-scheduler-quick-menu__editor-toggle';
    editorToggle.setAttribute('aria-expanded', 'false');
    editorToggle.textContent = '日時を追加';

    const editorBody = document.createElement('div');
    editorBody.className = 'x-scheduler-quick-menu__editor-body is-collapsed';

    editorToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isCollapsed = editorBody.classList.toggle('is-collapsed');
      editorToggle.setAttribute('aria-expanded', String(!isCollapsed));
    });

    editorPanel.appendChild(editorToggle);

    const defaults = getDefaultPresetParts();
    const editorGrid = document.createElement('div');
    editorGrid.className = 'x-scheduler-quick-menu__editor-grid';

    const yearField = createNumericField('年', 2000, 2100, 1, defaults.year);
    const monthField = createNumericField('月', 1, 12, 1, defaults.month);
    const dayField = createNumericField('日', 1, 31, 1, defaults.day);
    const hourField = createNumericField('時', 0, 23, 1, defaults.hour);
    const minuteField = createNumericField('分', 0, 59, 1, defaults.minute);

    editorGrid.appendChild(yearField.field);
    editorGrid.appendChild(monthField.field);
    editorGrid.appendChild(dayField.field);
    editorGrid.appendChild(hourField.field);
    editorGrid.appendChild(minuteField.field);
    editorBody.appendChild(editorGrid);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'x-scheduler-quick-menu__add-button';
    addButton.textContent = 'この設定を保存';
    addButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const currentPreset = buildPresetValueFromInputs({
        year: yearField.input,
        month: monthField.input,
        day: dayField.input,
        hour: hourField.input,
        minute: minuteField.input
      });

      if (!currentPreset) {
        logError('入力された日時が無効です。');
        return;
      }

      await savePreset(currentPreset);
      await refreshPresetList(menu);
    });

    editorBody.appendChild(addButton);
    editorPanel.appendChild(editorBody);

    const presetList = document.createElement('div');
    presetList.className = 'x-scheduler-quick-menu__preset-list';
    presetList.setAttribute('data-x-scheduler-preset-list', 'true');

    const dividerBottom = document.createElement('div');
    dividerBottom.className = 'x-scheduler-quick-menu__divider';

    menu.appendChild(fixedItem);
    menu.appendChild(dividerTop);
    menu.appendChild(editorPanel);
    menu.appendChild(dividerBottom);
    menu.appendChild(presetTitle);
    menu.appendChild(presetList);

    return menu;
  }

  async function refreshPresetList(menu) {
    if (!menu || !menu.isConnected) {
      return;
    }

    await loadPresetsIntoMenu(menu);
  }

  async function openScheduleMenu(button) {
    if (!button || !button.isConnected) {
      return;
    }

    ensureOutsideClickHandler();
    const existing = getMenu();
    if (existing) {
      existing.remove();
      if (openMenuButton === button) {
        openMenuButton = null;
        return;
      }
    }

    const menu = buildMenu();
    document.body.appendChild(menu);

    await loadPresetsIntoMenu(menu);
    positionMenu(menu, button);
    openMenuButton = button;
  }

  function positionMenu(menu, button) {
    const margin = 12;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const viewportMaxHeight = Math.max(120, viewportHeight - margin * 2);
    const viewportMaxWidth = Math.max(280, viewportWidth - margin * 2);
    const preferredWidth = Math.min(420, viewportMaxWidth);
    const preferredHeight = Math.min(680, viewportMaxHeight);

    const left = Math.max(margin, Math.round((viewportWidth - preferredWidth) / 2));
    const top = Math.max(margin, Math.round((viewportHeight - preferredHeight) / 2));

    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.width = `${preferredWidth}px`;
    menu.style.maxWidth = `${preferredWidth}px`;
    menu.style.maxHeight = `${preferredHeight}px`;
    menu.style.overflowY = 'auto';
    menu.style.overflowX = 'hidden';
    menu.style.overscrollBehavior = 'contain';
  }

  function toggleMenu(button, targetButton) {
    openMenuButton = button;
    void openScheduleMenu(button, targetButton);
  }

  function classifySelect(select) {
    const label = `${select.name || ''} ${select.id || ''} ${select.getAttribute('aria-label') || ''}`.toLowerCase();
    const options = Array.from(select.options || []);
    const optionValues = options.map((option) => `${option.value} ${option.textContent || ''}`.toLowerCase()).join(' ');
    const optionCount = options.length;

    const values = options.map((option) => Number(option.value)).filter((value) => !Number.isNaN(value));
    const minValue = values.length ? Math.min(...values) : null;
    const maxValue = values.length ? Math.max(...values) : null;

    if (/year|年/.test(label) || /year/.test(optionValues)) {
      return 'year';
    }
    if (/month|月/.test(label) || /month/.test(optionValues)) {
      return 'month';
    }
    if (/day|date|日/.test(label) || /day/.test(optionValues)) {
      return 'day';
    }
    if (/hour|時/.test(label) || /hour/.test(optionValues)) {
      return 'hour';
    }
    if (/minute|分/.test(label) || /minute/.test(optionValues)) {
      return 'minute';
    }

    if (minValue === 1 && maxValue && maxValue >= 28 && maxValue <= 31) {
      return 'day';
    }
    if (minValue === 1 && maxValue === 12) {
      return 'month';
    }
    if (minValue === 0 && maxValue === 23) {
      return 'hour';
    }
    if (minValue === 0 && maxValue === 59) {
      return 'minute';
    }
    if (values.length <= 2 && values.some((value) => value >= 2000 && value <= 2100)) {
      return 'year';
    }

    if (optionCount >= 50) {
      return 'minute';
    }
    if (optionCount >= 28 && optionCount <= 31) {
      return 'day';
    }
    if (optionCount >= 12 && optionCount <= 13) {
      return /月/.test(label) ? 'month' : 'hour';
    }
    if (optionCount >= 4 && optionCount <= 12) {
      if (/時/.test(label) || /hour/.test(optionValues)) {
        return 'hour';
      }
      if (/分/.test(label) || /minute/.test(optionValues)) {
        return 'minute';
      }
    }

    return null;
  }

  function mapScheduleSelects(selects) {
    const mapped = {
      month: null,
      day: null,
      year: null,
      hour: null,
      minute: null
    };

    if (selects.length >= 5) {
      [mapped.month, mapped.day, mapped.year, mapped.hour, mapped.minute] = selects.slice(0, 5);
      return mapped;
    }

    const remaining = [];

    selects.forEach((select) => {
      const role = classifySelect(select);
      if (role && !mapped[role]) {
        mapped[role] = select;
      } else {
        remaining.push(select);
      }
    });

    if (!mapped.month && remaining.length) {
      mapped.month = remaining.shift();
    }
    if (!mapped.day && remaining.length) {
      mapped.day = remaining.shift();
    }
    if (!mapped.year && remaining.length) {
      mapped.year = remaining.shift();
    }
    if (!mapped.hour && remaining.length) {
      mapped.hour = remaining.shift();
    }
    if (!mapped.minute && remaining.length) {
      mapped.minute = remaining.shift();
    }

    return mapped;
  }

  function setSelectByDateParts(select, value, role) {
    const numericValue = Number(value);
    const options = Array.from(select.options || []);
    const preferredValues = role === 'year'
      ? [String(numericValue)]
      : [String(numericValue).padStart(2, '0'), String(numericValue)];

    const exactMatch = options.find((option) => {
      const optionValue = String(option.value).trim();
      const optionText = (option.textContent || '').trim();
      return preferredValues.some((candidate) => optionValue === candidate || optionText === candidate);
    });

    if (exactMatch) {
      select.value = exactMatch.value;
    } else {
      const numericMatch = options.find((option) => Number(option.value) === numericValue);
      if (numericMatch) {
        select.value = numericMatch.value;
      } else {
        select.value = preferredValues[0];
      }
    }

    dispatchReactChange(select);
    logInfo(`Set ${role}`, { value: select.value });
  }

  function setSelectValue(select, value) {
    const options = Array.from(select.options || []);
    const normalizedValue = String(value);
    const matchedOption = options.find((option) => {
      const optionValue = String(option.value);
      const optionText = (option.textContent || '').trim();
      return optionValue === normalizedValue || optionText === normalizedValue || optionText === `${normalizedValue}月` || optionText === `${normalizedValue}日` || optionText === `${normalizedValue}時` || optionText === `${normalizedValue}分` || optionText.includes(normalizedValue);
    });

    if (matchedOption) {
      select.value = matchedOption.value;
    } else {
      select.value = normalizedValue;
    }

    dispatchReactChange(select);
  }

  function waitForSelects(modal) {
    return waitForElement(() => {
      const found = Array.from(modal.querySelectorAll('select'));
      return found.length >= 5 ? found : null;
    });
  }

  function waitForComposerToBeVisible() {
    return waitForElement(() => {
      const composer = document.querySelector('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]');
      return composer && composer.isConnected ? composer : null;
    }, 4000, 80);
  }

  function findUpdateButton(modal) {
    const candidates = Array.from(modal.querySelectorAll('button'));
    return candidates.find((button) => {
      const text = (button.textContent || '').trim();
      const label = `${button.getAttribute('aria-label') || ''} ${text}`.toLowerCase();
      return /update|更新|confirm|確認|save|完了/.test(label);
    }) || null;
  }

  function findScheduleButton() {
    return document.querySelector('[aria-label="予約設定"], [aria-label*="予約"], [data-testid*="schedule"]');
  }

  async function openScheduleDialog() {
    const button = findScheduleButton();
    if (!button) {
      throw new Error('予約設定アイコンが見つかりませんでした。');
    }

    clickElement(button);
    const modal = await waitForElement(() => findScheduleModalRoot());
    return modal;
  }

  async function runScheduleAutomation(timeValue) {
    try {
      const targetDate = parseLocalDateTime(timeValue) || computeTargetDate(timeValue);
      const modal = await openScheduleDialog();
      const selects = await waitForSelects(modal);

      const mapped = mapScheduleSelects(selects);
      const payload = {
        year: targetDate.getFullYear(),
        month: targetDate.getMonth() + 1,
        day: targetDate.getDate(),
        hour: targetDate.getHours(),
        minute: targetDate.getMinutes()
      };

      ['year', 'month', 'day', 'hour', 'minute'].forEach((key) => {
        const select = mapped[key];
        if (select) {
          setSelectByDateParts(select, payload[key], key);
        }
      });

      const confirmButton = findUpdateButton(modal);
      if (!confirmButton) {
        throw new Error('予約モーダルの更新ボタンが見つかりませんでした。');
      }

      setTimeout(() => {
        clickElement(confirmButton);
        setTimeout(() => {
          void waitForComposerToBeVisible().then(() => focusComposer()).catch(() => focusComposer());
        }, 200);
      }, 150);
      logInfo('Scheduled time applied', { timeValue, targetDate: targetDate.toISOString() });
    } catch (error) {
      logError('Failed to run schedule automation.', error);
    }
  }

  function installObserver() {
    if (globalMutationObserver) {
      return;
    }

    globalMutationObserver = new MutationObserver(() => {
      scheduleScan();
    });

    globalMutationObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  function start() {
    installObserver();
    scanForTweetButtons();
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);
    logInfo('Content script initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();