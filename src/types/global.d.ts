export {};

declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
    };
  }
}
