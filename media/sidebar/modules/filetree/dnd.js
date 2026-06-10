import { DND_EXPAND_DELAY, DND_THRESHOLD } from "./constants.js";
import { findNode, findParent, isAncestor } from "./treeHelpers.js";

/**
 * Attaches drag-source behaviour to a row element.
 * Uses a pointer threshold to prevent accidental drags on click.
 * @param {HTMLElement} row
 * @param {object} node
 * @param {DndState} state
 */
export function attachDragSource(row, node, state) {
  let startX = 0,
    startY = 0,
    pending = false;

  row.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("[data-ft-action]")) {
      return;
    }
    startX = e.clientX;
    startY = e.clientY;
    pending = true;
  });

  row.addEventListener("mousemove", (e) => {
    if (!pending) {
      return;
    }
    if (Math.hypot(e.clientX - startX, e.clientY - startY) >= DND_THRESHOLD) {
      pending = false;
      row.draggable = true;
    }
  });

  row.addEventListener("mouseup", () => {
    pending = false;
  });

  row.addEventListener("dragstart", (e) => {
    state.drag = { node, el: row };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);

    const ghost = createDragGhost(node);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    requestAnimationFrame(() => ghost.remove());

    row.dataset.ftDragging = "";
  });

  row.addEventListener("dragend", () => {
    clearDrop(state);
    delete row.dataset.ftDragging;
    state.drag = null;
  });
}

/**
 * Attaches delegated dragover/dragleave/drop handlers to the tree container.
 * @param {HTMLElement} container
 * @param {DndState} state
 * @param {() => object[]} getNodes - Returns the current live node array.
 * @param {Map<string, boolean>} expanded
 * @param {Function} rerenderNode
 * @param {() => object} getProvider - Returns the current provider.
 */
export function attachContainerDrop(
  container,
  state,
  getNodes,
  expanded,
  rerenderNode,
  getProvider,
) {
  container.addEventListener("dragover", (e) => {
    if (!state.drag) {
      return;
    }

    const nodes = getNodes();
    const targetNode = resolveDropFolder(e.target, container, nodes);
    if (!targetNode || !isValidDrop(state, nodes, targetNode)) {
      clearDrop(state);
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const targetRow = container.querySelector(
      `[data-ft-row="${CSS.escape(targetNode.id)}"]`,
    );
    if (!targetRow || state.dropTarget === targetRow) {
      return;
    }

    clearDrop(state);
    state.dropTarget = targetRow;
    targetRow.dataset.ftDropTarget = "";

    if (targetNode.type === "folder" && !expanded.get(targetNode.id)) {
      state.expandTimer = setTimeout(() => {
        expanded.set(targetNode.id, true);
        rerenderNode(targetNode.id);
      }, DND_EXPAND_DELAY);
    }
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget)) {
      clearDrop(state);
    }
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!state.drag) {
      return;
    }

    const nodes = getNodes();
    const provider = getProvider();
    const targetNode = resolveDropFolder(e.target, container, nodes);
    clearDrop(state);

    if (!targetNode || !isValidDrop(state, nodes, targetNode)) {
      return;
    }

    if (typeof provider.move !== "function") {
      console.warn(`[FileTree] provider "${provider.id}" has no move()`);
      return;
    }

    try {
      await provider.move(state.drag.node, targetNode);
    } catch (err) {
      console.error("[FileTree] move() failed:", err);
    }
  });
}

/**
 * Walks up the DOM from `el` to find the nearest folder or root node.
 * @param {Element} el
 * @param {HTMLElement} container
 * @param {object[]} nodes
 * @returns {object|null}
 */
function resolveDropFolder(el, container, nodes) {
  let current = el instanceof Element ? el : el?.parentElement;
  while (current && current !== container) {
    const nodeEl = current.closest("[data-ft-node]");
    if (!nodeEl) {
      break;
    }
    const node = findNode(nodes, nodeEl.dataset.ftNode);
    if (node && (node.type === "folder" || node.root)) {
      return node;
    }
    current = nodeEl.parentElement;
  }
  return null;
}

/**
 * Returns true if dropping the dragged node onto `targetNode` is allowed.
 * @param {DndState} state
 * @param {object[]} nodes
 * @param {object} targetNode
 * @returns {boolean}
 */
function isValidDrop(state, nodes, targetNode) {
  const dragNode = state.drag?.node;
  if (!dragNode) {
    return false;
  }
  if (dragNode.id === targetNode.id) {
    return false;
  }
  if (isAncestor(nodes, dragNode.id, targetNode.id)) {
    return false;
  }
  const currentParent = findParent(nodes, dragNode.id);
  if (currentParent?.id === targetNode.id) {
    return false;
  }
  return true;
}

/**
 * Clears the active drop-target highlight and cancels the auto-expand timer.
 * @param {DndState} state
 */
export function clearDrop(state) {
  if (state.dropTarget) {
    delete state.dropTarget.dataset.ftDropTarget;
    state.dropTarget = null;
  }
  if (state.expandTimer !== null) {
    clearTimeout(state.expandTimer);
    state.expandTimer = null;
  }
}

/**
 * Creates a floating ghost chip element shown during drag.
 * @param {object} node
 * @returns {HTMLElement}
 */
function createDragGhost(node) {
  const ghost = document.createElement("div");
  ghost.dataset.ftDragGhost = "";
  ghost.textContent = node.name;
  ghost.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;pointer-events:none;" +
    "font-family:var(--vscode-font-family,sans-serif);" +
    "font-size:12px;padding:2px 8px;border-radius:3px;" +
    "background:var(--vscode-badge-background,#4d4d4d);" +
    "color:var(--vscode-badge-foreground,#fff);" +
    "white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;";
  return ghost;
}

/**
 * @typedef {Object} DndState
 * @property {{ node: object, el: HTMLElement }|null} drag
 * @property {HTMLElement|null} dropTarget
 * @property {ReturnType<typeof setTimeout>|null} expandTimer
 */
