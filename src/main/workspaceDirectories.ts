import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function requireDirectory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length > 8192 || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error('Choose an absolute directory path.');
  }
  try {
    const resolved = await fs.realpath(value);
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error('Not a directory');
    return resolved;
  } catch {
    throw new Error('Directory is unavailable. Locate the folder and try again.');
  }
}

export function validateDirectoryName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 128
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
    || name === '.' || name === '..' || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) {
    throw new Error('Use a folder name of 1–128 characters without reserved characters or a trailing dot or space.');
  }
}

export async function renameWorkspaceDirectory(source: unknown, name: unknown): Promise<string> {
  validateDirectoryName(name);
  const current = await requireDirectory(source);
  if (typeof source !== 'string' || (await fs.lstat(source)).isSymbolicLink()
    || path.dirname(current) === current) throw new Error('Choose a workspace or project folder, not a root or linked directory.');
  const target = path.join(path.dirname(current), name);
  if (target.length > 8192) throw new Error('The directory path is too long.');
  if (target === current) return current;
  const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const sourceStat = await fs.stat(current);
  const caseOnly = process.platform === 'win32' && target.toLowerCase() === current.toLowerCase()
    && existing?.ino === sourceStat.ino && existing?.dev === sourceStat.dev;
  if (existing && (!caseOnly || existing.isSymbolicLink())) throw new Error('A folder with that name already exists. Nothing was renamed.');
  try { await fs.rename(current, target); }
  catch { throw new Error('Could not rename the folder. Close programs using it and check permissions, then try again.'); }
  return target;
}

export async function createWorkspaceDirectory(parent: unknown, name: unknown): Promise<string> {
  validateDirectoryName(name);
  const base = await requireDirectory(parent);
  const target = path.join(base, name);
  if (target.length > 8192) throw new Error('The directory path is too long. Choose a shorter name or parent path.');
  // Never merge with or follow an existing directory/symlink accidentally.
  try { await fs.mkdir(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A folder with that name already exists. Choose another name, or link it under Folders.');
    throw new Error('Could not create the folder. Check directory permissions and try again.');
  }
  return target;
}
