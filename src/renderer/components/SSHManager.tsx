import React, { useRef, useState } from 'react';
import { SavedSSHProfile, SessionInfo } from '../types';
import { PlusIcon, XCloseIcon, ServerIcon, AlertIcon, PlugIcon, PencilIcon, TrashIcon } from '../icons';
import ConfirmationDialog from './ConfirmationDialog';
import Tooltip from './Tooltip';

interface SSHManagerProps {
  sshProfiles: SavedSSHProfile[];
  onConnected: (session: SessionInfo) => void;
  onProfilesChange: (profiles: SavedSSHProfile[]) => void;
}

function profileId(host: string, port: number, username: string | undefined, auth: 'password' | 'key') {
  const userPrefix = username ? `${username}@` : '';
  return `${userPrefix}${host}:${port}:${auth}`.toLowerCase();
}

function connectionLabel(profile: SavedSSHProfile) {
  return `${profile.username ? `${profile.username}@` : ''}${profile.host}:${profile.port}`;
}

function usernamePayload(username: string) {
  const trimmed = username.trim();
  return trimmed ? { username: trimmed } : {};
}

function passwordPayload(auth: 'password' | 'key', password: string) {
  return auth === 'password' && password ? { password } : {};
}

function privateKeyPayload(auth: 'password' | 'key', privateKey: string) {
  return auth === 'key' && privateKey ? { privateKey } : {};
}

export default function SSHManager({
  sshProfiles,
  onConnected,
  onProfilesChange,
}: SSHManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [auth, setAuth] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [formConnecting, setFormConnecting] = useState(false);
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<{ label: string; message: string } | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profilePendingRemoval, setProfilePendingRemoval] = useState<SavedSSHProfile | null>(null);
  const newConnectionButtonRef = useRef<HTMLButtonElement>(null);

  const resetForm = () => {
    setHost('');
    setPort('22');
    setUsername('');
    setAuth('password');
    setPassword('');
    setPrivateKey('');
    setFormError(null);
    setEditingProfileId(null);
  };

  const saveProfile = (profile: SavedSSHProfile, replacedProfileId?: string | null) => {
    const next = [profile, ...sshProfiles.filter((p) => p.id !== profile.id && p.id !== replacedProfileId)];
    onProfilesChange(next);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedHost = host.trim();
    const trimmedUsername = username.trim();
    if (!trimmedHost) return;
    setFormConnecting(true);
    setFormError(null);

    const parsedPort = parseInt(port) || 22;
    const sessionId = `ssh-${Date.now()}`;
    const newProfileId = profileId(trimmedHost, parsedPort, trimmedUsername || undefined, auth);

    try {
      await window.janet.sshConnect({
        id: sessionId,
        host: trimmedHost,
        port: parsedPort,
        ...usernamePayload(trimmedUsername),
        auth,
        ...passwordPayload(auth, password),
        ...privateKeyPayload(auth, privateKey),
      });

      saveProfile({
        id: newProfileId,
        host: trimmedHost,
        port: parsedPort,
        username: trimmedUsername || undefined,
        auth,
        password: auth === 'password' && password ? password : undefined,
        privateKey: auth === 'key' && privateKey ? privateKey : undefined,
      }, editingProfileId);
      onConnected({
        id: sessionId,
        host: trimmedHost,
        port: parsedPort,
        ...(trimmedUsername ? { username: trimmedUsername } : {}),
        sshProfileId: newProfileId,
      });
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      setFormError(err.message || 'Connection failed');
    } finally {
      setFormConnecting(false);
    }
  };

  const editProfile = (profile: SavedSSHProfile) => {
    setHost(profile.host);
    setPort(String(profile.port));
    setUsername(profile.username ?? '');
    setAuth(profile.auth);
    setPassword(profile.password ?? '');
    setPrivateKey(profile.privateKey ?? '');
    setFormError(null);
    setEditingProfileId(profile.id);
    setShowForm(true);
  };

  const connectProfile = async (profile: SavedSSHProfile) => {
    const label = connectionLabel(profile);
    setConnectingProfileId(profile.id);
    setProfileError(null);
    const sessionId = `ssh-${Date.now()}`;

    try {
      await window.janet.sshConnect({
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        auth: profile.auth,
        ...(profile.auth === 'password' && profile.password ? { password: profile.password } : {}),
        ...(profile.auth === 'key' && profile.privateKey ? { privateKey: profile.privateKey } : {}),
      });
      onConnected({
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        sshProfileId: profile.id,
      });
    } catch (err: any) {
      setProfileError({ label, message: err?.message || 'Connection failed' });
    } finally {
      setConnectingProfileId((current) => current === profile.id ? null : current);
    }
  };

  const forgetProfile = () => {
    if (!profilePendingRemoval) return;
    onProfilesChange(sshProfiles.filter((profile) => profile.id !== profilePendingRemoval.id));
    setProfilePendingRemoval(null);
  };

  const hasSavedProfiles = sshProfiles.length > 0;
  const connectingProfile = sshProfiles.find((profile) => profile.id === connectingProfileId);
  const anyProfileConnecting = connectingProfileId !== null;
  const formToggleLabel = showForm
    ? editingProfileId ? 'Cancel editing' : 'Cancel new connection'
    : 'New SSH connection';

  const toggleForm = () => {
    if (showForm) {
      setShowForm(false);
      resetForm();
      return;
    }
    resetForm();
    setShowForm(true);
  };

  return (
    <div className="ssh-manager">
      <div className="ssh-header">
        <span className="section-title">SSH connections</span>
        <Tooltip label={formToggleLabel} placement="left">
          <button
            ref={newConnectionButtonRef}
            className="icon-btn"
            onClick={toggleForm}
            aria-label={formToggleLabel}
          >
            {showForm ? <XCloseIcon size="sm" /> : <PlusIcon size="sm" />}
          </button>
        </Tooltip>
      </div>

      {connectingProfile && (
        <div
          className="ssh-error"
          role="status"
          aria-live="polite"
          style={{ margin: '8px 14px 0', color: 'var(--text-secondary)' }}
        >
          <ServerIcon size="sm" /> Connecting to {connectionLabel(connectingProfile)}…
        </div>
      )}
      {profileError && (
        <div className="ssh-error" role="alert" style={{ margin: '8px 14px 0' }}>
          <AlertIcon size="sm" /> Couldn’t connect to {profileError.label}: {profileError.message}
        </div>
      )}

      {showForm && (
        <form className="ssh-form" onSubmit={handleConnect}>
          <label className="form-field">
            <span>Host</span>
            <input
              type="text"
              placeholder="server.example.com"
              aria-label="Host"
              autoFocus
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="form-input"
            />
          </label>
          <div className="form-row form-row-2">
            <label className="form-field">
              <span>Port</span>
              <input type="text" placeholder="22" aria-label="Port" value={port} onChange={(e) => setPort(e.target.value)} className="form-input" />
            </label>
            <label className="form-field">
              <span>Username</span>
              <input type="text" placeholder="Optional" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="form-input" />
            </label>
          </div>
          <div className="form-row auth-row" role="group" aria-label="Authentication method">
            <button
              type="button"
              className={`auth-btn ${auth === 'password' ? 'active' : ''}`}
              aria-pressed={auth === 'password'}
              onClick={() => setAuth('password')}
            >Password</button>
            <button
              type="button"
              className={`auth-btn ${auth === 'key' ? 'active' : ''}`}
              aria-pressed={auth === 'key'}
              onClick={() => setAuth('key')}
            >Private key</button>
          </div>
          {auth === 'password' ? (
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                placeholder="Optional — use SSH agent if blank"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
              />
            </label>
          ) : (
            <label className="form-field">
              <span>Private key</span>
              <textarea
                placeholder="Paste an RSA or Ed25519 private key"
                aria-label="Private key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="form-input form-textarea"
                rows={4}
              />
            </label>
          )}
          {formError && (
            <div className="ssh-error" role="alert">
              <AlertIcon size="sm" /> {formError}
            </div>
          )}
          <button
            type="submit"
            className="connect-btn"
            disabled={formConnecting || anyProfileConnecting || !host.trim()}
          >
            {formConnecting ? 'Connecting…' : editingProfileId ? 'Update and connect' : 'Save and connect'}
          </button>
        </form>
      )}

      <div className="ssh-sessions">
        {hasSavedProfiles && (
          <div className="ssh-list-group">
            <div className="ssh-list-title">Saved connections</div>
            {sshProfiles.map((profile) => {
              const isConnecting = connectingProfileId === profile.id;
              return (
                <div key={profile.id} className="ssh-session-item">
                  <div className="session-info">
                    <ServerIcon size="md" className="session-icon saved" />
                    <div className="session-details">
                      <span className="session-user">{profile.username || profile.host}</span>
                      <span className="session-host">{profile.username ? `@${profile.host}:${profile.port}` : `:${profile.port}`}</span>
                    </div>
                  </div>
                  <div className="session-actions">
                    <Tooltip label={isConnecting ? `Connecting to ${connectionLabel(profile)}` : `Connect to ${connectionLabel(profile)}`} placement="top">
                      <button
                        type="button"
                        className="session-action-btn"
                        onClick={() => connectProfile(profile)}
                        disabled={formConnecting || anyProfileConnecting}
                        aria-label={isConnecting ? `Connecting to ${connectionLabel(profile)}` : `Connect to ${connectionLabel(profile)}`}
                      >
                        <PlugIcon size="sm" />
                      </button>
                    </Tooltip>
                    <Tooltip label={`Edit ${connectionLabel(profile)}`} placement="top">
                      <button type="button" className="session-action-btn" onClick={() => editProfile(profile)} aria-label={`Edit ${connectionLabel(profile)}`}>
                        <PencilIcon size="sm" />
                      </button>
                    </Tooltip>
                    <Tooltip label={`Remove ${connectionLabel(profile)}`} placement="top">
                      <button type="button" className="session-action-btn danger" onClick={() => setProfilePendingRemoval(profile)} aria-label={`Remove ${connectionLabel(profile)}`}>
                        <TrashIcon size="sm" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!hasSavedProfiles && !showForm && (
          <div className="ssh-empty">
            <ServerIcon size="lg" />
            <strong>Connect to a remote host</strong>
            <span>Save a connection once, then reopen it from here.</span>
            <button type="button" className="empty-state-action" onClick={() => setShowForm(true)}>
              <PlusIcon size="sm" /> New connection
            </button>
          </div>
        )}
      </div>
      <ConfirmationDialog
        open={profilePendingRemoval !== null}
        title="Remove saved connection?"
        description={profilePendingRemoval
          ? `Remove ${connectionLabel(profilePendingRemoval)} and its saved credentials? Active sessions stay open, but saved tabs and presets cannot reconnect until you save this connection again.`
          : ''}
        confirmLabel="Remove connection"
        fallbackFocus={() => newConnectionButtonRef.current}
        onConfirm={forgetProfile}
        onCancel={() => setProfilePendingRemoval(null)}
      />
    </div>
  );
}
