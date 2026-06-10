/**
 * Registers all built-in actions onto a FileTree instance.
 */
export function registerBuiltinActions(tree) {
  tree.registerAction({
    id: "delete",
    label: "Delete",
    handler: async (node, provider) => {
      if (typeof provider.deleteNode !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no deleteNode()`,
        );
        return;
      }
      await provider.deleteNode(node);
    },
  });

  tree.registerAction({
    id: "rename",
    label: "Rename",
    handler: async (node, provider) => {
      if (typeof provider.renameNode !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no renameNode()`,
        );
        return;
      }
      await provider.renameNode(node);
    },
  });

  tree.registerAction({
    id: "newFile",
    label: "New File",
    handler: async (node, provider) => {
      if (typeof provider.createFile !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no createFile()`,
        );
        return;
      }
      await provider.createFile(node);
    },
  });

  tree.registerAction({
    id: "newFolder",
    label: "New Folder",
    handler: async (node, provider) => {
      if (typeof provider.createFolder !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no createFolder()`,
        );
        return;
      }
      await provider.createFolder(node);
    },
  });

  tree.registerAction({
    id: "refresh",
    label: "Refresh",
    handler: (_node, _provider, t) => t.refresh(),
  });

  tree.registerAction({
    id: "upload",
    label: "Upload to Board",
    handler: async (node, provider) => {
      if (typeof provider.uploadNode !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no uploadNode()`,
        );
        return;
      }
      await provider.uploadNode(node);
    },
  });

  tree.registerAction({
    id: "download",
    label: "Download to Workspace",
    handler: async (node, provider) => {
      if (typeof provider.downloadNode !== "function") {
        console.warn(
          `[FileTree] provider "${provider.id}" has no downloadNode()`,
        );
        return;
      }
      await provider.downloadNode(node);
    },
  });

  tree.registerAction({
    id: "run",
    label: "Run File",
    handler: async (node, provider) => {
      if (typeof provider.runNode !== "function") {
        console.warn(`[FileTree] provider "${provider.id}" has no runNode()`);
        return;
      }
      await provider.runNode(node);
    },
  });
}
