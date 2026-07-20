export const TERMINAL_PASTE_REQUEST_EVENT = 'janet:terminal-paste-request';

export interface TerminalPasteRequestDetail {
  termId: string;
  text: string;
}

export function requestTerminalPaste(termId: string, text: string): void {
  window.dispatchEvent(new CustomEvent<TerminalPasteRequestDetail>(TERMINAL_PASTE_REQUEST_EVENT, {
    detail: { termId, text },
  }));
}
