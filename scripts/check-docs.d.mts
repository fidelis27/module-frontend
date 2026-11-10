export interface CheckDocsOptions {
  root?: string;
  warn?: (warning: string) => void;
}

export function checkDocs(options?: CheckDocsOptions): string[];
