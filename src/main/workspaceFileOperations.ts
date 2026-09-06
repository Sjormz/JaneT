import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { AppSettings, SavedPaneNode, SavedSession } from './settings';
import { requireDirectory, validateDirectoryName } from './workspaceDirectories';
import { MAX_WORKSPACE_GROUPS, rebaseDirectory } from '../shared/workspaceGroups';

export interface WorkspaceLifecycleRequest {
  action: 'delete' | 'keep';
  groupId: string;
  projectId?: string;
  destinationParent?: string;
  expectedDirectory?: string;
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function plainDirectory(value: string): Promise<string> {
  const actual = await requireDirectory(value);
  if (path.relative(path.resolve(value), actual) !== '' || (await fs.lstat(value)).isSymbolicLink()) {
    throw new Error('Linked or redirected directories cannot be deleted or promoted as temporary projects.');
  }
  return actual;
}

function rebaseTree(node: SavedPaneNode, source: string, target: string, type: 'local' | 'ssh'): SavedPaneNode {
  if (node.type === 'split') return { ...node, children: node.children.map((child) => rebaseTree(child, source, target, type)) };
  return (node.terminalType ?? type) === 'ssh' ? node : { ...node, cwd: rebaseDirectory(node.cwd, source, target) };
}

// Hash files as streams, including hidden files. Never follow links into external trees.
async function directoryManifest(directory: string): Promise<string> {
  const entries: unknown[] = [];
  async function visit(relative: string): Promise<void> {
    const absolute = path.join(directory, relative);
    const info = await fs.lstat(absolute);
    if (info.isSymbolicLink()) {
      // Relative links within the project survive relocation; absolute/outside links do not.
      const link = await fs.readlink(absolute);
      if (path.isAbsolute(link) || !contains(directory, path.resolve(path.dirname(absolute), link))) {
        throw new Error(`External link cannot be safely relocated: ${relative}`);
      }
      entries.push([relative, 'link', link]);
    } else if (info.isDirectory()) {
      entries.push([relative, 'directory']);
      for (const name of (await fs.readdir(absolute)).sort()) await visit(path.join(relative, name));
    } else if (info.isFile()) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(absolute)) hash.update(chunk);
      entries.push([relative, 'file', info.size, hash.digest('hex')]);
    } else throw new Error(`Unsupported file type: ${relative}`);
  }
  await visit('');
  return JSON.stringify(entries);
}

export class WorkspaceFileOperations {
  // ponytail: one file operation at a time; use per-directory locks only if concurrent transfers are needed.
  private busy = false;
  constructor(private dependencies: {
    getSettings: () => AppSettings;
    setSession: (session: SavedSession) => void;
    trash: (directory: string) => Promise<void>;
    release: (directory: string) => void;
    protectedPaths: string[];
  }) {}

  async run(value: unknown): Promise<{ session: SavedSession; warning?: string }> {
    if (this.busy) throw new Error('Another workspace file operation is in progress.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace operation.');
    const request = value as WorkspaceLifecycleRequest;
    if (!['delete', 'keep'].includes(request.action) || typeof request.groupId !== 'string' || !request.groupId || request.groupId.length > 256
      || (request.projectId !== undefined && (typeof request.projectId !== 'string' || !request.projectId || request.projectId.length > 256))) throw new Error('Invalid workspace operation.');
    this.busy = true;
    try {
      const settings = this.dependencies.getSettings();
      const session = settings.session;
      const groups = session.groups ?? [];
      const group = groups.find((entry) => entry.id === request.groupId);
      if (!group || group.kind === 'folder' || !group.directory) throw new Error('Only managed temporary workspaces can be deleted or kept.');
      const base = await plainDirectory(group.directory);
      const project = request.projectId ? session.tabs.find((tab) => tab.id === request.projectId && tab.groupId === group.id) : undefined;
      if (request.projectId && (!project || !project.cwd)) throw new Error('Project directory is unavailable.');
      const source = project ? await plainDirectory(project.cwd!) : base;
      if (request.expectedDirectory !== undefined && (typeof request.expectedDirectory !== 'string'
        || path.relative(source, path.resolve(request.expectedDirectory)) !== '')) throw new Error('The directory changed after confirmation. Review the action again.');
      if (project && (path.dirname(source) !== base || source === base)) throw new Error('This session does not own a project folder. Close the session instead.');
      const protectedPaths = [...this.dependencies.protectedPaths, ...(settings.mainDirectory ? [settings.mainDirectory] : [])];
      if (path.dirname(source) === source || protectedPaths.some((protectedPath) => contains(source, path.resolve(protectedPath)))) {
        throw new Error('This directory is a protected root and cannot be removed.');
      }
      for (const other of groups) {
        if (!other.directory || other.id === group.id) continue;
        const actual = await fs.realpath(other.directory).catch(() => path.resolve(other.directory!));
        if (contains(source, actual) || (other.kind === 'folder' && contains(actual, source))) {
          throw new Error('This directory overlaps another workspace or Library entry. Nothing was removed.');
        }
      }
      const affected = session.tabs.filter((tab) => project ? tab.id === project.id : tab.groupId === group.id);
      for (const tab of session.tabs.filter((tab) => !affected.includes(tab))) {
        if (tab.cwd && contains(source, path.resolve(tab.cwd))) throw new Error('Another session uses this directory. Close that session first.');
        const usesSource = (node: SavedPaneNode): boolean => node.type === 'split' ? node.children.some(usesSource)
          : (node.terminalType ?? tab.type) !== 'ssh' && Boolean(node.cwd && contains(source, path.resolve(node.cwd)));
        if (usesSource(tab.root)) throw new Error('Another terminal uses this directory. Close that session first.');
      }
      this.dependencies.release(source);
      if (request.action === 'delete') {
        const next: SavedSession = { ...session, groups: project ? groups : groups.filter((entry) => entry.id !== group.id),
          tabs: session.tabs.filter((tab) => !affected.includes(tab)),
          activeTabId: affected.some((tab) => tab.id === session.activeTabId) ? null : session.activeTabId };
        // Commit removal before recycling: an interrupted operation may leave files, never a lost Library copy.
        this.dependencies.setSession(next);
        try { await this.dependencies.trash(source); }
        catch (error) {
          this.dependencies.setSession(session);
          throw new Error(`Could not send the folder to the Recycle Bin. Nothing was permanently deleted. ${String(error)}`);
        }
        return { session: next };
      }
      if (!project) throw new Error('Choose a project to keep in Library.');
      if (groups.length >= MAX_WORKSPACE_GROUPS) throw new Error('Library/workspace limit reached. Remove an unused entry first.');
      const parent = await requireDirectory(request.destinationParent);
      const name = path.basename(source);
      validateDirectoryName(name);
      const target = path.join(parent, name);
      if (contains(source, target) || contains(target, source)
        || (settings.mainDirectory && contains(await requireDirectory(settings.mainDirectory), target))
        || groups.some((entry) => !entry.kind && entry.directory && contains(path.resolve(entry.directory), target))) {
        throw new Error('Choose a permanent location outside temporary workspaces and the main directory.');
      }
      const manifest = await directoryManifest(source);
      try { await fs.mkdir(target); } // Exclusive reservation; never merge with an existing destination.
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`A folder already exists at ${target}. Choose another location; nothing was overwritten.`);
        throw error;
      }
      try {
        for (const name of await fs.readdir(source)) {
          await fs.cp(path.join(source, name), path.join(target, name), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true });
        }
        if (await directoryManifest(target) !== manifest || await directoryManifest(source) !== manifest) {
          throw new Error('The project changed during copying or verification failed.');
        }
      } catch (error) {
        throw new Error(`Project was not moved. The original is intact; inspect the incomplete copy at ${target}. ${String(error)}`);
      }
      const libraryId = `folder-${randomUUID()}`;
      const next: SavedSession = { ...session, groups: [...groups, { id: libraryId, kind: 'folder', name: project.title, directory: target }],
        tabs: session.tabs.map((tab) => tab.id === project.id ? { ...tab, groupId: libraryId, cwd: target, root: rebaseTree(tab.root, source, target, tab.type) } : tab) };
      try { this.dependencies.setSession(next); }
      catch (error) { throw new Error(`Could not save the Library entry. Original files remain at ${source}; the verified copy remains at ${target}. ${String(error)}`); }
      this.dependencies.release(source);
      try { await this.dependencies.trash(source); }
      catch { return { session: next, warning: `Saved to Library at ${target}. The original could not be recycled and remains at ${source}.` }; }
      return { session: next };
    } finally { this.busy = false; }
  }
}
