let _tooltipEl = null;
let _tooltipShowTimer = null;
let _tooltipHideTimer = null;
let _pendingTarget = null;

const SHOW_DELAY = 200;
const HIDE_DELAY = 100;
const FADE_MS = 100;
const OFFSET = 8;
const EDGE_MARGIN = 8;

/**
 * Handles positioning of tooltip.
 */
function _repositionTooltip(target) {
  if (!_tooltipEl || !target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const tipW = _tooltipEl.offsetWidth;
  const tipH = _tooltipEl.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let x = rect.left + rect.width / 2 - tipW / 2;
  x = Math.max(EDGE_MARGIN, Math.min(x, vw - tipW - EDGE_MARGIN));

  const spaceBelow = vh - rect.bottom - OFFSET;
  const spaceAbove = rect.top - OFFSET;
  let y;
  if (spaceBelow >= tipH || spaceBelow >= spaceAbove) {
    y = rect.bottom + OFFSET;
  } else {
    y = rect.top - tipH - OFFSET;
  }

  _tooltipEl.style.left = x + "px";
  _tooltipEl.style.top = y + "px";
}

/**
 * Creates tooltip if it does not exist yet, otherwise update existing.
 */
function _createOrUpdate(target, text) {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement("div");
    _tooltipEl.className = "tooltip";
    _tooltipEl.style.opacity = "0";
    _tooltipEl.style.transition = `opacity ${FADE_MS}ms ease`;
    document.body.appendChild(_tooltipEl);
  }

  _tooltipEl.textContent = text;
  _repositionTooltip(target);

  void _tooltipEl.offsetWidth;
  _tooltipEl.style.opacity = "1";
}

/**
 * Shows tooltip with text below or above the given element.
 */
export function showTooltip(e, text) {
  clearTimeout(_tooltipHideTimer);
  _tooltipHideTimer = null;

  const target = e.currentTarget;

  if (_tooltipEl) {
    _createOrUpdate(target, text);
    return;
  }

  _pendingTarget = target;
  clearTimeout(_tooltipShowTimer);
  _tooltipShowTimer = setTimeout(() => {
    _createOrUpdate(_pendingTarget, text);
  }, SHOW_DELAY);
}

/**
 * Hides the currently shown tooltip.
 */
export function hideTooltip() {
  clearTimeout(_tooltipShowTimer);
  _tooltipShowTimer = null;
  _pendingTarget = null;

  _tooltipHideTimer = setTimeout(() => {
    if (_tooltipEl) {
      _tooltipEl.style.transition = `opacity ${FADE_MS}ms ease`;
      _tooltipEl.style.opacity = "0";
      setTimeout(() => {
        _tooltipEl?.remove();
        _tooltipEl = null;
      }, FADE_MS);
    }
  }, HIDE_DELAY);
}

const _tooltipListeners = new WeakMap();

/**
 * Attach tooltip listeners to any element.
 * Usage: attachTooltip(el, "tooltip label")
 */
export function attachTooltip(el, text) {
  detachTooltip(el);

  const enter = (e) => showTooltip(e, text);
  const leave = () => hideTooltip();

  el.addEventListener("mouseenter", enter);
  el.addEventListener("mouseleave", leave);
  _tooltipListeners.set(el, { enter, leave });
}

/**
 * Detach tooltip listeners from element.
 */
export function detachTooltip(el) {
  const listeners = _tooltipListeners.get(el);
  if (listeners) {
    el.removeEventListener("mouseenter", listeners.enter);
    el.removeEventListener("mouseleave", listeners.leave);
    _tooltipListeners.delete(el);
  }
  hideTooltip();
}
