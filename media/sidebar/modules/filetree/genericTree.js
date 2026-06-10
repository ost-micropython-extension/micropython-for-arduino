import { attachTooltip, hideTooltip } from "../tooltip.js";
import { ACTION_ICONS } from "./constants.js";
import { registerBuiltinActions } from "./actions.js";
import { attachDragSource, attachContainerDrop } from "./dnd.js";
import {
  findNode,
  findParent,
  removeFromTree,
  insertSorted,
  formatSize,
  defaultActions,
} from "./treeHelpers.js";

/**
 * Provider interface:
 *   provider.id, requestNodes(), getActions?(node), onClick?(node),
 *   onDoubleClick?(node), deleteNode?(node), renameNode?(node),
 *   createFile?(node), createFolder?(node), uploadNode?(node),
 *   downloadNode?(node), runNode?(node), move?(node, targetFolder)
 *
 * Built-in action IDs:
 *   "run" | "delete" | "rename" | "newFile" | "newFolder" | "refresh" | "upload" | "download"
 *
 * Custom actions:
 *   tree.registerAction({ id, label, icon, handler(node, provider, tree) })
 */
export class FileTree {
  /**
   * @param {HTMLElement} container
   * @param {object} provider
   * @param {object} vscode - VS Code webview API handle.
   */
  constructor(container, provider, vscode) {
    this.container = container;
    this.provider = provider;
    this.boardActionsDisabled = false;

    /** @type {Map<string, boolean>} */
    this._expanded = new Map();
    this._selected = null;
    this._nodes = null;
    this._actions = new Map();
    this._vscode = vscode;

    /** @type {import("./dnd.js").DndState} */
    this._dnd = { drag: null, dropTarget: null, expandTimer: null };

    registerBuiltinActions(this);
    this._buildContainer();
  }

  /** Requests a fresh node list from the provider. */
  async refresh() {
    this.provider.requestNodes();
  }

  /** Collapses all folders and re-renders. */
  collapseAll() {
    this._expanded.clear();
    if (this._nodes) {
      this._render();
    }
  }

  /**
   * Registers a custom action.
   * @param {{ id: string, label: string, icon?: string, handler: Function }} action
   */
  registerAction(action) {
    this._actions.set(action.id, action);
  }

  /**
   * Replaces the current provider and refreshes.
   * @param {object} provider
   */
  setProvider(provider) {
    this.provider = provider;
    this.refresh();
  }

  /**
   * Selects the row matching `id` and scrolls it into view.
   * @param {string} id
   */
  selectById(id) {
    const row = this.container.querySelector(
      `[data-ft-row="${CSS.escape(id)}"]`,
    );
    if (!row) {
      return;
    }
    this._selected = id;
    this._clearSelection();
    row.dataset.ftSelected = "";
    row.setAttribute("aria-selected", "true");
    row.scrollIntoView({ block: "nearest" });
  }

  /** Clears the current selection. */
  removeSelection() {
    this._selected = null;
    this._clearSelection();
  }

  /**
   * Restores the expanded-state map (e.g. from persisted state).
   * @param {Map<string, boolean>} expandedMap
   */
  setState(expandedMap) {
    this._expanded = expandedMap;
  }

  /**
   * Enables or disables board-level actions and re-renders if changed.
   * @param {boolean} disabled
   */
  setBoardActionsDisabled(disabled) {
    if (disabled === this.boardActionsDisabled) {
      return;
    }
    this.boardActionsDisabled = disabled;
    if (this._nodes) {
      this._render();
    }
  }

  /**
   * Replaces the node list and re-renders.
   * @param {object[]} nodes
   */
  setNodes(nodes) {
    this._nodes = nodes;
    this._render();
  }

  /**
   * Inserts or replaces a node under the given parent, then re-renders that subtree.
   * @param {string} parentId
   * @param {object} node
   */
  addNode(parentId, node) {
    const parent = findNode(this._nodes, parentId);
    if (!parent) {
      return;
    }
    parent.children ??= [];
    const index = parent.children.findIndex((n) => n.id === node.id);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    insertSorted(parent.children, node);
    this._rerenderNode(parentId);
  }

  /**
   * Removes the node with the given ID and re-renders its former parent.
   * @param {string} id
   */
  removeNode(id) {
    const removed = removeFromTree(this._nodes, id, this._nodes);
    if (!removed) {
      return;
    }
    if (this._selected === id) {
      this.removeSelection();
    }
    this._rerenderNode(removed.parentId);
  }

  /**
   * Applies a patch to a node, then re-inserts it in sorted order.
   * @param {string} id
   * @param {object} patch
   */
  updateNode(id, patch) {
    const node = findNode(this._nodes, id);
    if (!node) {
      return;
    }
    const parentNode = findParent(this._nodes, id);
    this.removeNode(node.id);
    Object.assign(node, patch);
    this.addNode(parentNode.id, node);
  }

  /**
   * Renders an error state with a refresh button.
   * @param {Error|string} err
   */
  showError(err) {
    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.dataset.ftState = "error";

    const msg = document.createElement("div");
    msg.textContent = `Error: ${err?.message ?? err}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fullwidth-btn";
    btn.dataset.ftRefreshBtn = "";
    btn.innerHTML = ACTION_ICONS.refresh + " Refresh";
    btn.addEventListener("click", () => this.refresh());

    wrapper.appendChild(msg);
    wrapper.appendChild(btn);
    this.container.appendChild(wrapper);
  }

  /** Initialises ARIA role and attaches the container drop handler. */
  _buildContainer() {
    this.container.setAttribute("role", "tree");
    attachContainerDrop(
      this.container,
      this._dnd,
      () => this._nodes,
      this._expanded,
      this._rerenderNode.bind(this),
      () => this.provider,
    );
    this._render();
  }

  /** Fully re-renders the tree from `this._nodes`. */
  _render() {
    this.container.innerHTML = "";

    if (!this._nodes || this._nodes.length === 0) {
      const el = document.createElement("div");
      el.dataset.ftState = "empty";
      el.textContent = this.provider.emptyMessage ?? "No files found.";
      this.container.appendChild(el);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const node of this._nodes) {
      frag.appendChild(this._renderNode(node, 0));
    }
    this.container.appendChild(frag);
  }

  /**
   * Renders a single node and its children recursively.
   * @param {object} node
   * @param {number} depth
   * @returns {HTMLElement}
   */
  _renderNode(node, depth) {
    const isFolder = node.type === "folder";
    const isSelected = this._selected === node.id;

    const wrapper = document.createElement("div");
    wrapper.dataset.ftNode = node.id;
    wrapper.dataset.ftType = node.type;
    wrapper.dataset.ftDepth = depth;
    if (node.root) {
      wrapper.dataset.ftRoot = "";
    }

    const row = document.createElement("div");
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", depth + 1);
    row.setAttribute("aria-selected", isSelected);

    const pyFileOnBoard =
      this.provider.id === "boardfiles" && !isFolder && node.id.endsWith(".py");
    attachTooltip(
      row,
      `${node.name}${pyFileOnBoard ? "\ndoubleclick to open" : ""}`,
    );

    row.dataset.ftRow = node.id;
    if (isSelected) {
      row.dataset.ftSelected = "";
    }
    if (node.root) {
      row.dataset.ftRootRow = "";
    }

    if (!node.root) {
      row.draggable = true;
      attachDragSource(row, node, this._dnd);
    }

    const indent = document.createElement("span");
    indent.dataset.ftIndent = depth;

    const toggle = document.createElement("span");

    const label = document.createElement("span");
    label.dataset.ftLabel = node.type;
    label.textContent = node.name;

    const meta = document.createElement("span");
    meta.dataset.ftMeta = "";
    if (node.meta?.size) {
      meta.textContent = formatSize(node.meta.size);
    }

    row.appendChild(indent);
    row.appendChild(toggle);
    row.appendChild(label);
    row.appendChild(meta);
    row.appendChild(this._buildActions(node));

    const childrenEl = document.createElement("div");

    const updateToggle = () => {
      const open = this._expanded.get(node.id) ?? false;
      toggle.dataset.ftToggle = isFolder ? (open ? "open" : "closed") : "leaf";
      row.setAttribute("aria-expanded", open);
      childrenEl.dataset.ftChildren = open ? "open" : "closed";
    };
    updateToggle();

    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-ft-action]")) {
        return;
      }
      this._selected = node.id;
      this._clearSelection();
      row.dataset.ftSelected = "";
      row.setAttribute("aria-selected", "true");

      if (isFolder) {
        const open = this._expanded.get(node.id) ?? false;
        this._expanded.set(node.id, !open);
        this._vscode.postMessage({
          type: "setExpanded_" + this.provider.id,
          value: [...this._expanded],
        });
        updateToggle();
      } else {
        this.provider.onClick?.(node);
      }
    });

    row.addEventListener("dblclick", (e) => {
      if (!e.target.closest("[data-ft-action]") && !isFolder) {
        this.provider.onDoubleClick?.(node);
      }
    });

    wrapper.appendChild(row);

    if (isFolder && node.children?.length) {
      for (const child of node.children) {
        childrenEl.appendChild(this._renderNode(child, depth + 1));
      }
    }

    wrapper.appendChild(childrenEl);
    return wrapper;
  }

  /**
   * Builds the action button bar for a node.
   * @param {object} node
   * @returns {HTMLElement}
   */
  _buildActions(node) {
    const container = document.createElement("span");
    container.dataset.ftActions = "";

    const ids =
      typeof this.provider.getActions === "function"
        ? this.provider.getActions(node, this.boardActionsDisabled)
        : defaultActions(node);

    for (const id of ids) {
      const action = this._actions.get(id);
      if (!action) {
        continue;
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.ftAction = id;
      btn.setAttribute("aria-label", action.label);
      btn.innerHTML = action.icon ?? ACTION_ICONS[id] ?? action.label;

      attachTooltip(btn, action.label);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        hideTooltip();
        action.handler(node, this.provider, this);
      });

      container.appendChild(btn);
    }

    return container;
  }

  /** Removes the `data-ft-selected` attribute from all rows. */
  _clearSelection() {
    this.container
      .querySelectorAll("[data-ft-selected]")
      .forEach((el) => delete el.dataset.ftSelected);
  }

  /**
   * Re-renders only the subtree rooted at the given node ID.
   * Falls back to a full render when `id` is null.
   * @param {string|null} id
   */
  _rerenderNode(id) {
    if (id === null) {
      this._render();
      return;
    }
    const node = findNode(this._nodes, id);
    if (!node) {
      return;
    }
    const existing = this.container.querySelector(
      `[data-ft-node="${CSS.escape(id)}"]`,
    );
    if (!existing) {
      return;
    }
    const depth = parseInt(existing.dataset.ftDepth ?? "0");
    existing.replaceWith(this._renderNode(node, depth));
  }
}
