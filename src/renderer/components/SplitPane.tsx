import React, { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  getAllLeafIds, PaneDropSide, PaneNode, SplitNode, TerminalLeaf,
} from '../types';
import TerminalPane from './TerminalPane';
import {
  ChevronsRightIcon,
  ChevronsDownIcon,
  MaximizeIcon,
  RestoreIcon,
  XCloseIcon,
  TerminalTabIcon,
  SSHIcon,
} from '../icons';
import Tooltip from './Tooltip';

interface SplitPaneProps {
  node: PaneNode;
  tabId: string;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  onTerminalReady: (termId: string) => void;
  onTerminalRemoved: (termId: string) => void;
  onSplitPane: (leafId: string, direction: 'horizontal' | 'vertical') => void;
  onClosePane: (leafId: string) => void;
  onResizePane: (splitId: string, dividerIndex: number, leftFraction: number) => void;
  onMovePane: (draggedLeafId: string, targetLeafId: string, side: PaneDropSide) => void;
  draggedLeafId?: string | null;
  dropTarget?: { leafId: string; side: PaneDropSide } | null;
  onPaneDragStart: (leafId: string) => void;
  onPaneDragOver: (target: { leafId: string; side: PaneDropSide } | null) => void;
  onPaneDragEnd: () => void;
  maximizedLeafId?: string | null;
  onToggleMaximizePane: (leafId: string) => void;
  themeName?: string;
  fontSize?: number;
  fontFamily?: string;

  onCwdChange?: (termId: string, cwd: string) => void;
  /** Called when a terminal gains focus. */
  onTerminalFocus?: (termId: string) => void;
  /** The initial cwd for newly-created local terminals. */
  initialCwd?: string;
  /** Returns true when the given leafId already has a live PTY/session. */
  hasSessionForLeaf?: (leafId: string) => boolean;
  /** True once an SSH tab's transport exists and panes may open shells. */
  sshShellReady?: boolean;
  /** Reports whether a specific SSH transport closed unexpectedly. */
  isSshSessionDisconnected?: (sessionId?: string) => boolean;
  /** User clicked "Reconnect" on the SSH notice for this term. */
  onSshRetry?: (termId: string, dimensions: { cols: number; rows: number }) => void | Promise<void>;
  /** Total panes in the tab; propagated internally so leaf actions describe their real outcome. */
  totalPaneCount?: number;
}

/** Wraps a TerminalLeaf with split/close action buttons */
function TerminalPaneLeaf({
  leaf,
  tabType,
  sshSessionId,
  onTerminalReady,
  onTerminalRemoved,
  onSplitRight,
  onSplitDown,
  onClose,
  onToggleMaximize,
  draggedLeafId,
  dropTarget,
  onPaneDragStart,
  onPaneDragOver,
  onPaneDragEnd,
  onMovePane,
  isMaximized = false,
  themeName,
  fontSize,
  fontFamily,
  onCwdChange,
  onTerminalFocus,
  initialCwd,
  hasSessionForLeaf,
  sshShellReady,
  isSshSessionDisconnected,
  onSshRetry,
  totalPaneCount,
}: {
  leaf: TerminalLeaf;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  onTerminalReady: (id: string) => void;
  onTerminalRemoved: (id: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  onMovePane: (draggedLeafId: string, targetLeafId: string, side: PaneDropSide) => void;
  draggedLeafId?: string | null;
  dropTarget?: { leafId: string; side: PaneDropSide } | null;
  onPaneDragStart: (leafId: string) => void;
  onPaneDragOver: (target: { leafId: string; side: PaneDropSide } | null) => void;
  onPaneDragEnd: () => void;
  isMaximized?: boolean;
  themeName?: string;
  fontSize?: number;
  fontFamily?: string;
  onCwdChange?: (termId: string, cwd: string) => void;
  onTerminalFocus?: (termId: string) => void;
  initialCwd?: string;
  hasSessionForLeaf?: (leafId: string) => boolean;
  sshShellReady?: boolean;
  isSshSessionDisconnected?: (sessionId?: string) => boolean;
  onSshRetry?: (termId: string, dimensions: { cols: number; rows: number }) => void | Promise<void>;
  totalPaneCount: number;
}) {
  const leafType = leaf.terminalType ?? tabType;
  const PaneTypeIcon = leafType === 'ssh' ? SSHIcon : TerminalTabIcon;
  const paneTypeLabel = leafType === 'ssh' ? 'SSH' : 'Local terminal';
  const paneTitle = leaf.title?.trim();
  const paneLabel = paneTitle ? `${paneTitle} — ${paneTypeLabel} pane` : `${paneTypeLabel} pane`;
  const paneActionContext = paneTitle ? `${paneTitle} (${paneTypeLabel})` : paneTypeLabel;
  const hasMultiplePanes = totalPaneCount > 1;
  const closeLabel = hasMultiplePanes
    ? `Close pane — ${paneActionContext}`
    : `Close terminal tab — ${paneActionContext}`;
  const effectiveSshSessionId = leaf.sshSessionId ?? sshSessionId;
  const dropSideAt = (event: React.DragEvent): PaneDropSide => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = bounds.width ? (event.clientX - bounds.left) / bounds.width : 0;
    const y = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0;
    return ([['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]] as Array<[PaneDropSide, number]>)
      .reduce((nearest, candidate) => candidate[1] < nearest[1] ? candidate : nearest)[0];
  };
  const isDropTarget = dropTarget?.leafId === leaf.id;

  function toggleMaximize() {
    const startViewTransition = (document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    }).startViewTransition;
    if (startViewTransition && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      startViewTransition.call(document, () => flushSync(onToggleMaximize));
      return;
    }
    onToggleMaximize();
  }

  return (
    <div
      className={`terminal-leaf ${draggedLeafId === leaf.id ? 'pane-dragging' : ''}`}
      style={{ viewTransitionName: `terminal-pane-${leaf.id.replace(/[^a-zA-Z0-9_-]/g, '_')}` }}
      onDragOver={(event) => {
        if (!draggedLeafId || draggedLeafId === leaf.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onPaneDragOver({ leafId: leaf.id, side: dropSideAt(event) });
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) onPaneDragOver(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (draggedLeafId && draggedLeafId !== leaf.id) onMovePane(draggedLeafId, leaf.id, dropSideAt(event));
      }}
    >
      <div
        className="terminal-leaf-header"
        draggable={!isMaximized}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('button')) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', leaf.id);
          onPaneDragStart(leaf.id);
        }}
        onDragEnd={onPaneDragEnd}
      >
        <Tooltip label={paneLabel} placement="bottom">
          <span className="leaf-title" aria-label={paneLabel}><PaneTypeIcon size="sm" /></span>
        </Tooltip>
        <div className="leaf-actions">
          {hasMultiplePanes && (
            <Tooltip label={isMaximized ? 'Restore pane layout' : `Maximize pane — ${paneActionContext}`} placement="bottom">
              <button className="leaf-btn" onClick={toggleMaximize} aria-label={isMaximized ? 'Restore pane layout' : `Maximize pane — ${paneActionContext}`}>
                {isMaximized ? <RestoreIcon size="sm" /> : <MaximizeIcon size="sm" />}
              </button>
            </Tooltip>
          )}
          {!isMaximized && (
            <>
              <Tooltip label="Split pane right" placement="bottom">
                <button className="leaf-btn" onClick={onSplitRight} aria-label="Split pane right"><ChevronsRightIcon size="sm" /></button>
              </Tooltip>
              <Tooltip label="Split pane below" placement="bottom">
                <button className="leaf-btn" onClick={onSplitDown} aria-label="Split pane below"><ChevronsDownIcon size="sm" /></button>
              </Tooltip>
            </>
          )}
          <Tooltip label={closeLabel} placement="bottom">
            <button className="leaf-btn leaf-close" onClick={onClose} aria-label={closeLabel}><XCloseIcon size="sm" /></button>
          </Tooltip>
        </div>
      </div>
      <div className="terminal-leaf-body">
        <TerminalPane
          termId={leaf.id}
          tabType={leafType}
          sshSessionId={effectiveSshSessionId}
          onReady={onTerminalReady}
          onRemoved={onTerminalRemoved}
          themeName={themeName}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onCwdChange={onCwdChange}
          onFocus={onTerminalFocus}
          initialCwd={leaf.cwd ?? initialCwd}
          hasSession={hasSessionForLeaf?.(leaf.id)}
          sshShellReady={leaf.sshShellReady ?? sshShellReady}
          sshConnectionLost={leafType === 'ssh' && isSshSessionDisconnected?.(effectiveSshSessionId)}
          onSshRetry={onSshRetry}
        />
      </div>
      {isDropTarget && <div className={`pane-drop-indicator pane-drop-${dropTarget.side}`} aria-hidden="true" />}
    </div>
  );
}

/** Draggable divider that updates split sizes in React state. */
function SplitDivider({
  splitId,
  direction,
  dividerIndex,
  fraction,
  onResize,
}: {
  splitId: string;
  direction: 'horizontal' | 'vertical';
  dividerIndex: number;
  fraction: number;
  onResize: (splitId: string, dividerIndex: number, leftFraction: number) => void;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      const divider = e.currentTarget as HTMLElement;
      const container = divider.closest('.split-container') as HTMLElement;
      if (!container) return;

      const children = container.querySelectorAll(':scope > .split-child') as NodeListOf<HTMLElement>;
      const leftChild = children[dividerIndex] as HTMLElement | undefined;
      const rightChild = children[dividerIndex + 1] as HTMLElement | undefined;
      if (!leftChild || !rightChild) return;

      const isVertical = direction === 'vertical';
      const clientDim = isVertical ? 'clientX' : 'clientY';
      const startPos = (e as unknown as MouseEvent)[clientDim];
      const leftStartSize = isVertical ? leftChild.offsetWidth : leftChild.offsetHeight;
      const rightStartSize = isVertical ? rightChild.offsetWidth : rightChild.offsetHeight;
      const totalSize = leftStartSize + rightStartSize;
      const minSize = 50;

      const handleMouseMove = (ev: MouseEvent) => {
        const currentPos = ev[clientDim as keyof MouseEvent] as number;
        const delta = currentPos - startPos;
        let newLeft = leftStartSize + delta;
        let newRight = rightStartSize - delta;

        if (newLeft < minSize) {
          newLeft = minSize;
          newRight = totalSize - minSize;
        } else if (newRight < minSize) {
          newRight = minSize;
          newLeft = totalSize - minSize;
        }

        onResize(splitId, dividerIndex, newLeft / totalSize);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, dividerIndex, onResize, splitId],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const decreaseKey = direction === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const increaseKey = direction === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    let next = fraction;
    if (event.key === decreaseKey) next -= event.shiftKey ? 0.1 : 0.05;
    else if (event.key === increaseKey) next += event.shiftKey ? 0.1 : 0.05;
    else if (event.key === 'Home') next = 0.1;
    else if (event.key === 'End') next = 0.9;
    else return;
    event.preventDefault();
    onResize(splitId, dividerIndex, Math.max(0.1, Math.min(0.9, next)));
  };

  return (
    <div
      className={`split-divider split-divider-${direction}`}
      role="separator"
      tabIndex={0}
      aria-label={direction === 'vertical' ? 'Resize left and right panes' : 'Resize upper and lower panes'}
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuenow={Math.round(fraction * 100)}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    />
  );
}

function splitChildFlex(size: number | undefined) {
  return `${size ?? 1} 1 0%`;
}

function findBranchForLeaf(node: PaneNode, leafId: string): PaneNode | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null;
  for (const child of node.children) {
    if (child.type === 'leaf' && child.id === leafId) return child;
    const nested = child.type === 'split' ? findBranchForLeaf(child, leafId) : null;
    if (nested) return child;
  }
  return null;
}

/** Recursive split pane renderer */
export default function SplitPane(props: SplitPaneProps) {
  const {
    node,
    tabId,
    tabType,
    sshSessionId,
    onTerminalReady,
    onTerminalRemoved,
    onSplitPane,
    onClosePane,
    onResizePane,
    onMovePane,
    draggedLeafId,
    dropTarget,
    onPaneDragStart,
    onPaneDragOver,
    onPaneDragEnd,
    maximizedLeafId,
    onToggleMaximizePane,
    themeName,
    fontSize,
    fontFamily,
    onCwdChange,
    onTerminalFocus,
    initialCwd,
    hasSessionForLeaf,
    sshShellReady,
    isSshSessionDisconnected,
    onSshRetry,
  } = props;
  const totalPaneCount = props.totalPaneCount ?? getAllLeafIds(node).length;

  if (node.type === 'leaf') {
    return (
      <TerminalPaneLeaf
        leaf={node}
        tabType={tabType}
        sshSessionId={sshSessionId}
        onTerminalReady={onTerminalReady}
        onTerminalRemoved={onTerminalRemoved}
        onSplitRight={() => onSplitPane(node.id, 'vertical')}
        onSplitDown={() => onSplitPane(node.id, 'horizontal')}
        onClose={() => onClosePane(node.id)}
        onToggleMaximize={() => onToggleMaximizePane(node.id)}
        onMovePane={onMovePane}
        draggedLeafId={draggedLeafId}
        dropTarget={dropTarget}
        onPaneDragStart={onPaneDragStart}
        onPaneDragOver={onPaneDragOver}
        onPaneDragEnd={onPaneDragEnd}
        isMaximized={maximizedLeafId === node.id}
        themeName={themeName}
        fontSize={fontSize}
        fontFamily={fontFamily}
        onCwdChange={onCwdChange}
        onTerminalFocus={onTerminalFocus}
        initialCwd={initialCwd}
        hasSessionForLeaf={hasSessionForLeaf}
        sshShellReady={sshShellReady}
        isSshSessionDisconnected={isSshSessionDisconnected}
        onSshRetry={onSshRetry}
        totalPaneCount={totalPaneCount}
      />
    );
  }

  const splitNode = node as SplitNode;

  if (maximizedLeafId) {
    const maximizedBranch = findBranchForLeaf(splitNode, maximizedLeafId);
    if (maximizedBranch) {
      return (
        <div className="split-container split-maximized">
          <SplitPane
            node={maximizedBranch}
            tabId={tabId}
            tabType={tabType}
            sshSessionId={sshSessionId}
            onTerminalReady={onTerminalReady}
            onTerminalRemoved={onTerminalRemoved}
            onSplitPane={onSplitPane}
            onClosePane={onClosePane}
            onResizePane={onResizePane}
            onMovePane={onMovePane}
            draggedLeafId={draggedLeafId}
            dropTarget={dropTarget}
            onPaneDragStart={onPaneDragStart}
            onPaneDragOver={onPaneDragOver}
            onPaneDragEnd={onPaneDragEnd}
            maximizedLeafId={maximizedLeafId}
            onToggleMaximizePane={onToggleMaximizePane}
            themeName={themeName}
            fontSize={fontSize}
            fontFamily={fontFamily}
            onCwdChange={onCwdChange}
            onTerminalFocus={onTerminalFocus}
            initialCwd={initialCwd}
            hasSessionForLeaf={hasSessionForLeaf}
            sshShellReady={sshShellReady}
            isSshSessionDisconnected={isSshSessionDisconnected}
            onSshRetry={onSshRetry}
            totalPaneCount={totalPaneCount}
          />
        </div>
      );
    }
  }

  return (
    <div className={`split-container split-${splitNode.direction}`}>
      {splitNode.children.map((child, i) => {
        const leftSize = splitNode.sizes[i - 1] ?? 1;
        const rightSize = splitNode.sizes[i] ?? 1;
        const dividerFraction = leftSize / (leftSize + rightSize);
        return (
        <React.Fragment key={child.id}>
          {i > 0 && (
            <SplitDivider
              splitId={splitNode.id}
              direction={splitNode.direction}
              dividerIndex={i - 1}
              fraction={dividerFraction}
              onResize={onResizePane}
            />
          )}
          <div className="split-child" style={{ flex: splitChildFlex(splitNode.sizes[i]) }}>
            <SplitPane
              node={child}
              tabId={tabId}
              tabType={tabType}
              sshSessionId={sshSessionId}
              onTerminalReady={onTerminalReady}
              onTerminalRemoved={onTerminalRemoved}
              onSplitPane={onSplitPane}
              onClosePane={onClosePane}
              onResizePane={onResizePane}
              onMovePane={onMovePane}
              draggedLeafId={draggedLeafId}
              dropTarget={dropTarget}
              onPaneDragStart={onPaneDragStart}
              onPaneDragOver={onPaneDragOver}
              onPaneDragEnd={onPaneDragEnd}
              maximizedLeafId={maximizedLeafId}
              onToggleMaximizePane={onToggleMaximizePane}
              themeName={themeName}
              fontSize={fontSize}
              fontFamily={fontFamily}
              onCwdChange={onCwdChange}
              onTerminalFocus={onTerminalFocus}
              initialCwd={initialCwd}
              hasSessionForLeaf={hasSessionForLeaf}
              sshShellReady={sshShellReady}
              isSshSessionDisconnected={isSshSessionDisconnected}
              onSshRetry={onSshRetry}
              totalPaneCount={totalPaneCount}
            />
          </div>
        </React.Fragment>
        );
      })}
    </div>
  );
}
