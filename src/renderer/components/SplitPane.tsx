import React, { useCallback, useRef } from 'react';
import {
  PaneNode, SplitNode, TerminalLeaf,
} from '../types';
import TerminalPane from './TerminalPane';

interface SplitPaneProps {
  node: PaneNode;
  tabId: string;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  onTerminalReady: (termId: string) => void;
  onTerminalRemoved: (termId: string) => void;
  onSplitPane: (leafId: string, direction: 'horizontal' | 'vertical') => void;
  onClosePane: (leafId: string) => void;
  themeName?: string;
  fontSize?: number;
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
  themeName,
  fontSize,
}: {
  leaf: TerminalLeaf;
  tabType: 'local' | 'ssh';
  sshSessionId?: string;
  onTerminalReady: (id: string) => void;
  onTerminalRemoved: (id: string) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  onClose: () => void;
  themeName?: string;
  fontSize?: number;
}) {
  return (
    <div className="terminal-leaf">
      <div className="terminal-leaf-header">
        <span className="leaf-title">{leaf.title || 'terminal'}</span>
        <div className="leaf-actions">
          <button className="leaf-btn" onClick={onSplitRight} title="Split right">
            ▮▶
          </button>
          <button className="leaf-btn" onClick={onSplitDown} title="Split down">
            ▮▼
          </button>
          <button className="leaf-btn leaf-close" onClick={onClose} title="Close pane">
            ×
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
        />
      </div>
    </div>
  );
}

/** Draggable divider that directly manipulates DOM for instant resize feedback */
function SplitDivider({
  direction,
  dividerIndex,
}: {
  direction: 'horizontal' | 'vertical';
  dividerIndex: number;
}) {
  const dragRef = useRef<{
    startPos: number;
    leftChild: HTMLElement;
    rightChild: HTMLElement;
    leftStartSize: number;
    rightStartSize: number;
    totalSize: number;
  } | null>(null);

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

      const dim = direction === 'vertical' ? 'offsetWidth' : 'offsetHeight';
      const clientDim = direction === 'vertical' ? 'clientX' : 'clientY';

      dragRef.current = {
        startPos: (e as unknown as MouseEvent)[clientDim],
        leftChild,
        rightChild,
        leftStartSize: leftChild[dim],
        rightStartSize: rightChild[dim],
        totalSize: leftChild[dim] + rightChild[dim],
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;

        const currentPos = ev[clientDim as keyof MouseEvent] as number;
        const delta = currentPos - d.startPos;

        // Minimum sizes (50px prevents collapsing)
        const minSize = 50;
        let newLeft = d.leftStartSize + delta;
        let newRight = d.rightStartSize - delta;

        // Clamp
        if (newLeft < minSize) {
          newLeft = minSize;
          newRight = d.totalSize - minSize;
        } else if (newRight < minSize) {
          newRight = minSize;
          newLeft = d.totalSize - minSize;
        }

        // Apply flex values based on pixel ratios
        if (direction === 'vertical') {
          d.leftChild.style.flex = `0 0 ${newLeft}px`;
          d.rightChild.style.flex = `0 0 ${newRight}px`;
        } else {
          d.leftChild.style.flex = `0 0 ${newLeft}px`;
          d.rightChild.style.flex = `0 0 ${newRight}px`;
        }
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, dividerIndex],
  );

  return (
    <div
      className={`split-divider split-divider-${direction}`}
      onMouseDown={handleMouseDown}
    />
  );
}

/** Recursive split pane renderer */
export default function SplitPane(props: SplitPaneProps) {
  const { node, tabType, sshSessionId, onTerminalReady, onTerminalRemoved, onSplitPane, onClosePane, themeName, fontSize } = props;

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
        themeName={themeName}
        fontSize={fontSize}
      />
    );
  }

  const splitNode = node as SplitNode;

  return (
    <div className={`split-container split-${splitNode.direction}`}>
      {splitNode.children.map((child, i) => (
        <React.Fragment key={child.id}>
          {i > 0 && (
            <SplitDivider
              direction={splitNode.direction}
              dividerIndex={i - 1}
            />
          )}
          <div className="split-child" style={{ flex: 1 }}>
            <SplitPane
              node={child}
              tabType={tabType}
              sshSessionId={sshSessionId}
              onTerminalReady={onTerminalReady}
              onTerminalRemoved={onTerminalRemoved}
              onSplitPane={onSplitPane}
              onClosePane={onClosePane}
              themeName={themeName}
              fontSize={fontSize}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
