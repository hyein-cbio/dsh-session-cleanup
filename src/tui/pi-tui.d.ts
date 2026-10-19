// Ambient types for the leftover picker imports. The package is not installed.
declare module "@earendil-works/pi-tui" {
  export interface Component {
    render(width: number): string[];
    handleInput(data: string): void;
    invalidate?(): void;
  }

  export function matchesKey(data: string, key: string): boolean;
  export function truncateToWidth(
    text: string,
    width: number,
    ellipsis?: string,
    trimWhitespace?: boolean,
  ): string;
  export function visibleWidth(text: string): number;
}
