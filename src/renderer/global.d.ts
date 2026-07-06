import { JanetAPI } from '../main/preload';

declare module '*.css';

declare global {
  interface Window {
    janet: JanetAPI;
  }
}
