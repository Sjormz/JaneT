export const TERMINAL_SEARCH_REQUEST_EVENT = 'janet:terminal-search-request';

export interface TerminalSearchRequestDetail {
  termId: string;
}

export function requestTerminalSearch(termId: string): void {
  window.dispatchEvent(new CustomEvent<TerminalSearchRequestDetail>(
    TERMINAL_SEARCH_REQUEST_EVENT,
    { detail: { termId } },
  ));
}
