import React from 'react';
import {
  // Titlebar / window
  Minus, Square, Copy, X,
  // Sidebar sections
  FolderTree, KeyRound, GitBranch, Settings as SettingsIcon,
  // Sidebar actions
  Plus, RefreshCw, ArrowLeft, Eye, EyeOff, X as XIcon,
  ChevronRight, ChevronDown, ChevronsUpDown,
  // Tabs
  Terminal as TerminalIcon, Lock,
  // File types
  Folder, FolderOpen, FileText, FileCode, FileJson, FileImage,
  FileMusic, FileVideo, FileArchive, FileCog, FileType,
  // Git
  GitCommit, GitMerge, RotateCcw,
  // Status
  Circle, CircleDot,
  // UI
  Search, SearchX, ArrowUp, ArrowDown, ArrowRight,
  Pencil, Trash2, Sliders, Type,
  ChevronsRight, ChevronsDown, ChevronsUp, ChevronsLeft,
  // SSH
  Plug, Unplug, Server,
  // Command palette / shortcuts
  Command, CornerDownLeft,
  // Theme
  Palette, Sun, Moon, Monitor,
  // Misc
  MoreHorizontal, Loader2, AlertCircle, Check, Save,
  List,
} from 'lucide-react';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Centralised size + stroke tokens so every icon in the app is
 * visually consistent. Use the named sizes (xs/sm/md/lg/xl) for buttons
 * and inline UI; pass a raw number for specialised contexts.
 */
const SIZE_PX: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

interface IconProps {
  size?: IconSize | number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
}

function withDefaults(Comp: React.ComponentType<any>, props: IconProps) {
  const { size = 'sm', strokeWidth = 1.75, className, style } = props;
  const px = typeof size === 'number' ? size : SIZE_PX[size];
  return (
    <span
      className={`icon ${className ?? ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, ...style }}
      aria-hidden={props['aria-hidden'] ?? true}
    >
      <Comp
        size={px}
        strokeWidth={strokeWidth}
        aria-hidden={true}
        focusable={false}
      />
    </span>
  );
}

function make(Comp: React.ComponentType<any>) {
  return function Icon(props: IconProps) {
    return withDefaults(Comp, props);
  };
}

// Window controls
export const MinimizeIcon = make(Minus);
export const MaximizeIcon = make(Square);
export const RestoreIcon = make(Copy);
export const CloseIcon = make(X);

// Sidebar / activity
export const FilesIcon = make(FolderTree);
export const SSHIcon = make(KeyRound);
export const SourceControlIcon = make(GitBranch);
export const SettingsIconCmp = make(SettingsIcon);

// Sidebar actions
export const PlusIcon = make(Plus);
export const MinusIcon = make(Minus);
export const RefreshIcon = make(RefreshCw);
export const ArrowLeftIcon = make(ArrowLeft);
export const EyeIcon = make(Eye);
export const EyeOffIcon = make(EyeOff);
export const XCloseIcon = make(XIcon);
export const ChevronRightIcon = make(ChevronRight);
export const ChevronDownIcon = make(ChevronDown);
export const ChevronsUpDownIcon = make(ChevronsUpDown);

// Tabs
export const TerminalTabIcon = make(TerminalIcon);
export const LockIcon = make(Lock);

// File types
export const FolderIcon = make(Folder);
export const FolderOpenIcon = make(FolderOpen);
export const FileTextIcon = make(FileText);
export const FileCodeIcon = make(FileCode);
export const FileJsonIcon = make(FileJson);
export const FileImageIcon = make(FileImage);
export const FileMusicIcon = make(FileMusic);
export const FileVideoIcon = make(FileVideo);
export const FileArchiveIcon = make(FileArchive);
export const FileCogIcon = make(FileCog);
export const FileGenericIcon = make(FileType);

// Git
export const GitCommitIcon = make(GitCommit);
export const GitMergeIcon = make(GitMerge);
export const RotateIcon = make(RotateCcw);

// Status dots
export const CircleIcon = make(Circle);
export const CircleDotIcon = make(CircleDot);

// UI
export const SearchIcon = make(Search);
export const SearchCloseIcon = make(SearchX);
export const ArrowUpIcon = make(ArrowUp);
export const ArrowDownIcon = make(ArrowDown);
export const ArrowRightIcon = make(ArrowRight);
export const PencilIcon = make(Pencil);
export const TrashIcon = make(Trash2);
export const SlidersIcon = make(Sliders);
export const TypeIcon = make(Type);
export const CopyIcon = make(Copy);
export const ChevronsRightIcon = make(ChevronsRight);
export const ChevronsDownIcon = make(ChevronsDown);
export const ChevronsUpIcon = make(ChevronsUp);
export const ChevronsLeftIcon = make(ChevronsLeft);

// SSH
export const PlugIcon = make(Plug);
export const UnplugIcon = make(Unplug);
export const ServerIcon = make(Server);
export const MoreIcon = make(MoreHorizontal);
export const ListIcon = make(List);

// Command palette
export const CommandIcon = make(Command);
export const EnterIcon = make(CornerDownLeft);

// Theme
export const PaletteIcon = make(Palette);
export const SunIcon = make(Sun);
export const MoonIcon = make(Moon);
export const MonitorIcon = make(Monitor);

// Misc
export const SpinnerIcon = make(Loader2);
export const AlertIcon = make(AlertCircle);
export const CheckIcon = make(Check);
export const SaveIcon = make(Save);

/**
 * Map a file extension to a Lucide icon component.
 * Returns { Component, isDirectory } for type-specific styling.
 */
export function fileIconFor(filename: string, isDir: boolean, isOpen?: boolean) {
  if (isDir) return isOpen ? FolderOpenIcon : FolderIcon;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'ps1'];
  const dataExts = ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'config', 'env'];
  const docExts = ['md', 'mdx', 'txt', 'log', 'csv'];
  const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a'];
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'];
  if (codeExts.includes(ext)) return FileCodeIcon;
  if (dataExts.includes(ext)) return FileJsonIcon;
  if (docExts.includes(ext)) return FileTextIcon;
  if (imgExts.includes(ext)) return FileImageIcon;
  if (audioExts.includes(ext)) return FileMusicIcon;
  if (videoExts.includes(ext)) return FileVideoIcon;
  if (archiveExts.includes(ext)) return FileArchiveIcon;
  if (['exe', 'dll', 'so', 'dylib', 'app'].includes(ext)) return FileCogIcon;
  if (filename.toLowerCase() === 'dockerfile' || filename.startsWith('.')) return FileCogIcon;
  return FileGenericIcon;
}

export { SIZE_PX };
