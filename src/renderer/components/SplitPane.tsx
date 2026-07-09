import React, { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  PaneNode, SplitNode, TerminalLeaf,
} from '../types';
import TerminalPane from './TerminalPane';
import {
  ChevronsRightIcon,
  ChevronsDownIcon,
  MaximizeIcon,
  RestoreIcon,
  XCloseIcon,
} from '../icons';

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
  maximizedLeafId?: string | null;
  onToggleMaximizePane: (leafId: string) => void;
  themeName?: string;
  fontSize?: number;

  onCwdChange?: (termId: string, cwd: string) => void;
  /** Called when a terminal gains focus. */
  onTerminalFocus?: (termId: string) => void;
  /** The initial cwd for newly-created local terminals. */
  initialCwd?: string;
  /** Returns true when the given leafId already has a live PTY/session. */
  hasSessionForLeaf?: (leafId: string) => boolean;
  /** True once an SSH tab's transport exists and panes may open shells. */
  sshShellReady?: boolean;
  /** User clicked "Reconnect" on the SSH notice for this term. */
  onSshRetry?: (termId: string) => void;
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
  isMaximized = false,
  themeName,
  fontSize,
  onCwdChange,
  onTerminalFocus,
  initialCwd,
  hasSessionForLeaf,
  sshShellReady,
  onSshRetry,
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
  isMaximized?: boolean;
  themeName?: string;
  fontSize?: number;
  onCwdChange?: (termId: string, cwd: string) => void;
  onTerminalFocus?: (termId: string) => void;
  initialCwd?: string;
  hasSessionForLeaf?: (leafId: string) => boolean;
  sshShellReady?: boolean;
  onSshRetry?: (termId: string) => void;
}) {
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
      className="terminal-leaf"
      style={{ viewTransitionName: `terminal-pane-${leaf.id.replace(/[^a-zA-Z0-9_-]/g, '_')}` }}
    >
      <div className="terminal-leaf-header">
        <span className="leaf-title">{leaf.title || 'terminal'}</span>
        <div className="leaf-actions">
          <button
            className="leaf-btn"
            onClick={toggleMaximize}
            title={isMaximized ? 'Restore pane layout' : 'Maximize pane'}
            aria-label={isMaximized ? 'Restore pane layout' : 'Maximize pane'}
          >
            {isMaximized ? <RestoreIcon size="sm" /> : <MaximizeIcon size="sm" />}
          </button>
          {!isMaximized && (
            <>
              <button className="leaf-btn" onClick={onSplitRight} title="Split right" aria-label="Split right">
                <ChevronsRightIcon size="sm" />
              </button>
              <button className="leaf-btn" onClick={onSplitDown} title="Split down" aria-label="Split down">
                <ChevronsDownIcon size="sm" />
              </button>
            </>
          )}
          <button className="leaf-btn leaf-close" onClick={onClose} title="Close pane" aria-label="Close pane">
            <XCloseIcon size="sm" />
          </button>
        </div>
      </div>
      <div className="terminal-leaf-body">
        <TerminalPane
          termId={leaf.id}
          tabType={tabType}
          sshSessionId={sshSessionId}
          onReady={onTerminalReady}
          onRemoved={onTerminalRemoved}
          themeName={themeName}
          fontSize={fontSize}
          onCwdChange={onCwdChange}
          onFocus={onTerminalFocus}
          initialCwd={leaf.cwd ?? initialCwd}
          hasSession={hasSessionForLeaf?.(leaf.id)}
          sshShellReady={sshShellReady}
          onSshRetry={onSshRetry}
        />
      </div>
    </div>
  );
}

/** Draggable divider that updates split sizes in React state. */
function SplitDivider({
  splitId,
  direction,
  dividerIndex,
  onResize,
}: {
  splitId: string;
  direction: 'horizontal' | 'vertical';
  dividerIndex: number;
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

  return <div className={`split-divider split-divider-${direction}`} onMouseDown={handleMouseDown} />;
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
    maximizedLeafId,
    onToggleMaximizePane,
    themeName,
    fontSize,
    onCwdChange,
    onTerminalFocus,
    initialCwd,
    hasSessionForLeaf,
    sshShellReady,
    onSshRetry,
  } = props;

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
        isMaximized={maximizedLeafId === node.id}
        themeName={themeName}
        fontSize={fontSize}
        onCwdChange={onCwdChange}
        onTerminalFocus={onTerminalFocus}
        initialCwd={initialCwd}
        hasSessionForLeaf={hasSessionForLeaf}
        sshShellReady={sshShellReady}
        onSshRetry={onSshRetry}
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
            maximizedLeafId={maximizedLeafId}
            onToggleMaximizePane={onToggleMaximizePane}
            themeName={themeName}
            fontSize={fontSize}
            onCwdChange={onCwdChange}
            onTerminalFocus={onTerminalFocus}
            initialCwd={initialCwd}
            hasSessionForLeaf={hasSessionForLeaf}
            sshShellReady={sshShellReady}
            onSshRetry={onSshRetry}
          />
        </div>
      );
    }
  }

  return (
    <div className={`split-container split-${splitNode.direction}`}>
      {splitNode.children.map((child, i) => (
        <React.Fragment key={child.id}>
          {i > 0 && (
            <SplitDivider
              splitId={splitNode.id}
              direction={splitNode.direction}
              dividerIndex={i - 1}
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
              maximizedLeafId={maximizedLeafId}
              onToggleMaximizePane={onToggleMaximizePane}
              themeName={themeName}
              fontSize={fontSize}
              onCwdChange={onCwdChange}
              onTerminalFocus={onTerminalFocus}
              initialCwd={initialCwd}
              hasSessionForLeaf={hasSessionForLeaf}
              sshShellReady={sshShellReady}
              onSshRetry={onSshRetry}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
