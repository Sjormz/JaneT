import React from "react";
import { SessionInfo } from "../types";
import { CircleDotIcon, TerminalTabIcon, FolderIcon } from "../icons";
import packageJson from "../../../package.json";

interface StatusBarProps {
  sshSessions: SessionInfo[];
  activeTerminalsCount: number;
  /** The cwd of the focused terminal. */
  cwd: string;
  /** True if the active tab is an SSH tab. */
  isRemote?: boolean;
  /** SSH host, if applicable — used in the status display. */
  remoteHost?: string;
}

export default function StatusBar({
  sshSessions,
  activeTerminalsCount,
  cwd,
  isRemote,
  remoteHost,
}: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <TerminalTabIcon size="xs" /> v{packageJson.version}
        </span>
        {sshSessions.length > 0 && (
          <span className="status-item">
            <CircleDotIcon size="xs" className="status-ssh-dot" />
            {sshSessions.length} SSH
          </span>
        )}
        {cwd && (
          <span className="status-item status-cwd" title={cwd}>
            <FolderIcon size="xs" />
            {isRemote && remoteHost ? (
              <span className="status-cwd-remote">
                {remoteHost}: {cwd}
              </span>
            ) : (
              <span className="status-cwd-local">{cwd}</span>
            )}
          </span>
        )}
      </div>
      <div className="status-right">
        <span className="status-item">
          {activeTerminalsCount} terminal{activeTerminalsCount !== 1 ? "s" : ""}
        </span>
        <span className="status-item platform">{navigator.platform}</span>
      </div>
    </div>
  );
}
