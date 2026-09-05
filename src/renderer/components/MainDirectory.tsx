import React, { useEffect, useState } from 'react';
import BrandMark from './BrandMark';

export default function MainDirectory({ directory, onboarding = false, onChange }: {
  directory: string | null;
  onboarding?: boolean;
  onChange: (directory: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!onboarding || !window.janet.onPrepareForClose) return;
    return window.janet.onPrepareForClose(async (request) => {
      await window.janet.resolvePrepareForClose({ requestId: request.requestId, resolution: busy ? 'cancel' : 'saved' });
    });
  }, [onboarding, busy]);
  const Heading = onboarding ? 'h1' : 'h2';
  const choose = async () => {
    setBusy(true); setError('');
    try {
      const selected = await window.janet.selectLocalDirectory();
      if (selected) await onChange(await window.janet.workspaceDirectory({ parent: selected }));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const content = <>
    {onboarding && <div className="directory-onboarding-brand"><BrandMark size={40} /><span>Welcome to JaneT</span></div>}
    <Heading>{onboarding ? 'A home for your work' : 'Main directory'}</Heading>
    <p>{onboarding ? 'Choose a home for temporary workspaces and projects. Keep work in Library when you want to save it elsewhere. You can change this location from the Workspaces heading.' : 'New temporary workspaces are created here. Existing workspaces and Library locations stay where they are; no files are moved.'}</p>
    {directory && <p className="main-directory-path">{directory}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button type="button" className="connect-btn" disabled={busy} onClick={() => void choose()}>{busy ? 'Setting up…' : directory ? 'Change main directory' : 'Choose main directory'}</button>
    {onboarding && <button type="button" className="directory-onboarding-quit" disabled={busy} onClick={() => window.janet.windowClose()}>Quit JaneT</button>}
  </>;
  return onboarding ? <main className="app-startup directory-setup"><section className="directory-onboarding" aria-label="Set up main directory">{content}</section></main>
    : <section className="theme-section main-directory-settings">{content}</section>;
}
