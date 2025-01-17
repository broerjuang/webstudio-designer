import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { TreeNode, INDENT } from "./tree-node";
import { PlacementIndicator } from "./placement-indicator";
import {
  type DropTarget,
  useHold,
  useDrop,
  useDrag,
  useAutoScroll,
  useDragCursor,
} from "../primitives/dnd";
import { Box } from "../box";
import { useHorizontalShift } from "./horizontal-shift";

export type TreeProps<Data extends { id: string }> = {
  root: Data;

  canLeaveParent: (item: Data) => boolean;
  canAcceptChild: (item: Data) => boolean;
  findItemById: (root: Data, id: string) => Data | undefined;
  getItemPath: (root: Data, id: string) => Data[];
  getItemPathWithPositions: (
    root: Data,
    id: string
  ) => Array<{ item: Data; position: number }>;
  getItemChildren: (item: Data) => Data[];
  renderItem: (props: { data: Data; isSelected: boolean }) => React.ReactNode;

  selectedItemId?: string;
  onSelect?: (itemId: string) => void;
  animate?: boolean;
  onDragEnd: (event: {
    itemId: string;
    dropTarget: { itemId: string; position: number | "end" };
  }) => void;
  onDelete: (itemId: string) => void;
};

export const Tree = <Data extends { id: string }>({
  root,
  getItemPathWithPositions,
  canLeaveParent,
  canAcceptChild,
  findItemById,
  getItemPath,
  getItemChildren,
  renderItem,
  selectedItemId,
  onSelect,
  animate,
  onDragEnd,
  onDelete,
}: TreeProps<Data>) => {
  const { getIsExpanded, setIsExpanded } = useExpandState({
    root,
    selectedItemId,
    getItemPath,
    getItemChildren,
  });

  const rootRef = useRef<HTMLElement | null>(null);

  const [dragItem, setDragItem] = useState<Data>();
  const [dropTarget, setDropTarget] = useState<DropTarget<Data>>();

  const getDropTargetElement = useCallback(
    (id: string): HTMLElement | null | undefined =>
      rootRef.current?.querySelector(`[data-drop-target-id="${id}"]`),
    []
  );

  const [shiftedDropTarget, setHorizontalShift] = useHorizontalShift({
    dragItem,
    dropTarget,
    root,
    getIsExpanded,
    getItemPath,
    getItemPathWithPositions,
    getItemChildren,
    canAcceptChild,
  });

  const getFallbackDropTarget = () => {
    return {
      data: root,
      element: getDropTargetElement(root.id) as HTMLElement,
      final: true,
    };
  };

  const useHoldHandler = useHold<DropTarget<Data>>({
    isEqual: (a, b) => a.data.id === b.data.id,
    holdTimeThreshold: 600,
    onHold: (dropTarget) => {
      if (
        getItemChildren(dropTarget.data).length > 0 ||
        getIsExpanded(dropTarget.data) === false
      ) {
        setIsExpanded(dropTarget.data, true);
      }
    },
  });

  const dropHandlers = useDrop<Data>({
    emulatePointerAlwaysInRootBounds: true,

    placementPadding: 0,

    elementToData: (element) => {
      const id = (element as HTMLElement).dataset.dropTargetId;
      const instance = id && findItemById(root, id);
      return instance || false;
    },

    swapDropTarget: (dropTarget) => {
      if (dragItem === undefined || dropTarget === undefined) {
        return getFallbackDropTarget();
      }

      if (dropTarget.data.id === root.id) {
        return dropTarget;
      }

      const path = getItemPath(root, dropTarget.data.id);
      path.reverse();

      if (dropTarget.area === "top" || dropTarget.area === "bottom") {
        path.shift();
      }

      // Don't allow to drop inside drag item or any of its children
      const dragItemIndex = path.findIndex(
        (instance) => instance.id === dragItem.id
      );
      if (dragItemIndex !== -1) {
        path.splice(0, dragItemIndex + 1);
      }

      const data = path.find(canAcceptChild);

      if (data === undefined) {
        return getFallbackDropTarget();
      }

      const element = getDropTargetElement(data.id);

      if (element == null) {
        return getFallbackDropTarget();
      }

      return { data, element, final: true };
    },

    onDropTargetChange: (dropTarget) => {
      useHoldHandler.setData(dropTarget);
      setDropTarget(dropTarget);
    },

    getValidChildren: (element) => {
      return Array.from(
        element.querySelectorAll(":scope > div > [data-drop-target-id]")
      );
    },
  });

  const dragHandlers = useDrag<Data>({
    shiftDistanceThreshold: INDENT,

    elementToData: (element) => {
      const dragItemElement = element.closest("[data-drag-item-id]");
      if (!(dragItemElement instanceof HTMLElement)) {
        return false;
      }
      const id = dragItemElement.dataset.dragItemId;
      if (id === undefined || id === root.id) {
        return false;
      }

      const instance = findItemById(root, id);

      if (instance === undefined) {
        return false;
      }

      if (canLeaveParent(instance) === false) {
        return false;
      }

      return instance;
    },
    onStart: ({ data }) => {
      onSelect?.(data.id);
      setDragItem(data);
      dropHandlers.handleStart();
      autoScrollHandlers.setEnabled(true);
    },
    onMove: (point) => {
      dropHandlers.handleMove(point);
      autoScrollHandlers.handleMove(point);
    },
    onShiftChange: ({ shifts }) => {
      setHorizontalShift(shifts);
    },
    onEnd: ({ isCanceled }) => {
      if (shiftedDropTarget && dragItem && isCanceled === false) {
        onDragEnd({
          itemId: dragItem.id,
          dropTarget: {
            itemId: shiftedDropTarget.item.id,
            position: shiftedDropTarget.position,
          },
        });
      }

      autoScrollHandlers.setEnabled(false);
      setHorizontalShift(0);
      setDragItem(undefined);
      setDropTarget(undefined);
      dropHandlers.handleEnd({ isCanceled });
      useHoldHandler.reset();
    },
  });

  const autoScrollHandlers = useAutoScroll();

  useDragCursor(dragItem !== undefined);

  const keyboardNavigation = useKeyboardNavigation({
    root,
    getItemChildren,
    findItemById,
    selectedItemId,
    getIsExpanded,
    setIsExpanded,
    onDelete,
    onEsc: dragHandlers.cancelCurrentDrag,
  });

  return (
    <Box
      css={{
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        flexBasis: 0,
        flexGrow: 1,
      }}
      ref={(element) => {
        rootRef.current = element;
        autoScrollHandlers.targetRef(element);
        dragHandlers.rootRef(element);
        dropHandlers.rootRef(element);
      }}
      onScroll={dropHandlers.handleScroll}
    >
      <Box
        ref={keyboardNavigation.rootRef}
        onClick={keyboardNavigation.handleClick}
        onBlur={keyboardNavigation.handleBlur}
      >
        <TreeNode
          renderItem={renderItem}
          getItemChildren={getItemChildren}
          animate={animate}
          onSelect={onSelect}
          selectedItemId={selectedItemId}
          itemData={root}
          level={0}
          getIsExpanded={getIsExpanded}
          setIsExpanded={setIsExpanded}
          onExpandTransitionEnd={dropHandlers.handleDomMutation}
          forceHoverStateAtItem={shiftedDropTarget?.item?.id}
        />
      </Box>

      {shiftedDropTarget?.placement &&
        createPortal(
          <PlacementIndicator placement={shiftedDropTarget.placement} />,
          document.body
        )}
    </Box>
  );
};

const useKeyboardNavigation = <Data extends { id: string }>({
  root,
  getItemChildren,
  findItemById,
  selectedItemId,
  getIsExpanded,
  setIsExpanded,
  onDelete,
  onEsc,
}: {
  root: Data;
  getItemChildren: (item: Data) => Data[];
  findItemById: (root: Data, id: string) => Data | undefined;
  selectedItemId: string | undefined;
  getIsExpanded: (instance: Data) => boolean;
  setIsExpanded: (instance: Data, isExpanded: boolean) => void;
  onDelete: (itemId: string) => void;
  onEsc: () => void;
}) => {
  const selectedItem = useMemo(() => {
    if (selectedItemId === undefined) {
      return undefined;
    }
    return findItemById(root, selectedItemId);
  }, [root, selectedItemId, findItemById]);

  const flatCurrentlyExpandedTree = useMemo(() => {
    const result = [] as string[];
    const traverse = (instance: Data) => {
      result.push(instance.id);
      if (getIsExpanded(instance)) {
        getItemChildren(instance).forEach(traverse);
      }
    };
    traverse(root);
    return result;
  }, [root, getIsExpanded, getItemChildren]);

  const rootRef = useHotkeys(
    "up,down,right,left,space,backspace,delete,esc",
    (event, { shortcut }) => {
      if (selectedItem === undefined) {
        return;
      }
      if (shortcut === "right" && getIsExpanded(selectedItem) === false) {
        setIsExpanded(selectedItem, true);
      }
      if (shortcut === "left" && getIsExpanded(selectedItem)) {
        setIsExpanded(selectedItem, false);
      }
      if (shortcut === "space") {
        setIsExpanded(selectedItem, !getIsExpanded(selectedItem));
      }
      if (shortcut === "up") {
        const index = flatCurrentlyExpandedTree.indexOf(selectedItem.id);
        if (index > 0) {
          setFocus(flatCurrentlyExpandedTree[index - 1], "changing");
          event.preventDefault(); // prevent scrolling
        }
      }
      if (shortcut === "down") {
        const index = flatCurrentlyExpandedTree.indexOf(selectedItem.id);
        if (index < flatCurrentlyExpandedTree.length - 1) {
          setFocus(flatCurrentlyExpandedTree[index + 1], "changing");
          event.preventDefault(); // prevent scrolling
        }
      }
      if (shortcut === "backspace" || shortcut === "delete") {
        onDelete(selectedItem.id);
      }
      if (shortcut === "esc") {
        onEsc();
      }
    },
    [
      selectedItem,
      flatCurrentlyExpandedTree,
      getIsExpanded,
      setIsExpanded,
      onDelete,
    ]
  );

  const setFocus = useCallback(
    (itemId: string, reason: "restoring" | "changing") => {
      const itemButton = rootRef.current?.querySelector(
        `[data-item-button-id="${itemId}"]`
      );
      if (itemButton instanceof HTMLElement) {
        itemButton.focus({ preventScroll: reason === "restoring" });
      }
    },
    [rootRef]
  );

  const hadFocus = useRef(false);
  const prevRoot = useRef(root);
  useEffect(() => {
    const haveFocus =
      rootRef.current?.contains(document.activeElement) === true;

    const isRootChanged = prevRoot.current !== root;
    prevRoot.current = root;

    // If we've lost focus due to a root update, we want to get it back.
    // This can happen when we delete an item or on drag-end.
    if (
      isRootChanged &&
      haveFocus === false &&
      hadFocus.current === true &&
      selectedItemId !== undefined
    ) {
      setFocus(selectedItemId, "restoring");
    }
  }, [root, rootRef, selectedItemId, setFocus]);

  // onBlur doesn't fire when the activeElement is removed from the DOM
  useEffect(() => {
    const haveFocus =
      rootRef.current?.contains(document.activeElement) === true;
    hadFocus.current = haveFocus;
  });

  return {
    rootRef(element: HTMLElement | null) {
      rootRef.current = element;
    },
    handleClick(event: React.MouseEvent<Element>) {
      // When clicking on an item button make sure it gets focused.
      // (see https://zellwk.com/blog/inconsistent-button-behavior/)
      const itemButton = (event.target as HTMLElement).closest(
        "[data-item-button-id]"
      );
      if (itemButton instanceof HTMLElement) {
        itemButton.focus();
        return;
      }

      // When clicking anywhere else in the tree,
      // make sure the selected item doesn't loose focus.
      if (selectedItemId !== undefined) {
        setFocus(selectedItemId, "restoring");
      }
    },
    handleBlur() {
      hadFocus.current = false;
    },
  };
};

const useExpandState = <Data extends { id: string }>({
  selectedItemId,
  root,
  getItemPath,
  getItemChildren,
}: {
  root: Data;
  getItemPath: (root: Data, id: string) => Data[];
  getItemChildren: (item: Data) => Data[];
  selectedItemId?: string;
}) => {
  const [record, setRecord] = useState<Record<string, boolean>>({});

  // We want to automatically expand all parents of the selected instance whenever it changes
  const prevSelectedItemId = useRef(selectedItemId);
  const prevRoot = useRef(root);
  useEffect(() => {
    if (
      selectedItemId === prevSelectedItemId.current &&
      prevRoot.current === root
    ) {
      return;
    }
    prevSelectedItemId.current = selectedItemId;
    prevRoot.current = root;
    if (selectedItemId === undefined) {
      return;
    }
    const path = getItemPath(root, selectedItemId).map(
      (instance) => instance.id
    );
    // Don't want to expand the selected instance itself
    path.pop();
    const toExpand = path.filter((id) => record[id] !== true);
    if (toExpand.length === 0) {
      return;
    }
    setRecord((record) => {
      const newRecord = { ...record };
      for (const id of toExpand) {
        newRecord[id] = true;
      }
      return newRecord;
    });
  }, [record, root, selectedItemId, getItemPath]);

  const getIsExpanded = useCallback(
    (instance: Data) => {
      // root is always expanded
      if (instance.id === root.id) {
        return true;
      }

      return (
        getItemChildren(instance).length > 0 && record[instance.id] === true
      );
    },
    [record, root, getItemChildren]
  );

  const setIsExpanded = useCallback((instance: Data, expanded: boolean) => {
    setRecord((record) => ({ ...record, [instance.id]: expanded }));
  }, []);

  return { getIsExpanded, setIsExpanded };
};
