/**
 * Recursively finds a node by ID within a tree.
 * @param {object[]|null} nodes
 * @param {string} id
 * @returns {object|null}
 */
export function findNode(nodes, id) {
  for (const node of nodes ?? []) {
    if (node.id === id) {
      return node;
    }
    const found = findNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Finds the parent node of the node with the given ID.
 * @param {object[]|null} nodes
 * @param {string} id
 * @param {object|null} parent
 * @returns {object|null}
 */
export function findParent(nodes, id, parent = null) {
  for (const node of nodes ?? []) {
    if (node.id === id) {
      return parent;
    }
    const found = findParent(node.children, id, node);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Removes a node from the tree by ID.
 * @param {object[]} nodes - Root-level nodes (mutated in place).
 * @param {string} id
 * @param {object[]|null} allNodes - Full tree root, used to resolve parentId.
 * @returns {{ parentId: string|null }|null}
 */
export function removeFromTree(nodes, id, allNodes) {
  for (let i = 0; i < (nodes ?? []).length; i++) {
    if (nodes[i].id === id) {
      const parent = findParent(allNodes, id);
      nodes.splice(i, 1);
      return { parentId: parent?.id ?? null };
    }
    const found = removeFromTree(nodes[i].children, id, allNodes);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Inserts a node into a children array, sorted folders-first then by name.
 * @param {object[]} children - Mutated in place.
 * @param {object} node
 */
export function insertSorted(children, node) {
  children.push(node);
  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

/**
 * Returns true if `ancestorId` is an ancestor of `nodeId` in the given tree.
 * @param {object[]} nodes
 * @param {string} ancestorId
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isAncestor(nodes, ancestorId, nodeId) {
  let parent = findParent(nodes, nodeId);
  while (parent) {
    if (parent.id === ancestorId) {
      return true;
    }
    parent = findParent(nodes, parent.id);
  }
  return false;
}

/**
 * Formats a byte count into a human-readable string (B / KB / MB).
 * @param {number|null} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes === null || isNaN(bytes)) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/**
 * Returns the default action IDs for a node based on its type.
 * @param {object} node
 * @returns {string[]}
 */
export function defaultActions(node) {
  if (node.root) {
    return ["newFile", "newFolder", "refresh"];
  }
  if (node.type === "folder") {
    return ["newFile", "newFolder", "rename", "delete"];
  }
  return ["rename", "delete"];
}
