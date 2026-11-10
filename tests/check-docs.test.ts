import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocs } from "../scripts/check-docs.mjs";

const temporaryRoots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "check-docs-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "docs/adr"), { recursive: true });
  mkdirSync(path.join(root, "docs/archive"), { recursive: true });
  write(root, "package.json", JSON.stringify({ version: "1.0.0" }));
  write(root, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n");
  write(
    root,
    "README.md",
    "# English guide\n\n## Provider\n\n## Consumer\n\n```sh\nnpm test\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n",
  );
  write(
    root,
    "README.pt-BR.md",
    "# Guia português\n\n## Provider\n\n## Consumer\n\n```sh\nnpm test\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n",
  );
  write(
    root,
    "docs/README.md",
    "# Docs\n\n[ADRs](./adr/README.md)\n[Archive](./archive/README.md)\n",
  );
  write(
    root,
    "docs/adr/README.md",
    "# ADR index\n\n[0001](./0001-record.md)\n",
  );
  write(root, "docs/adr/0001-record.md", "# ADR one\n");
  write(
    root,
    "docs/archive/README.md",
    "# Archive index\n\n[Old](./old-document.md)\n",
  );
  write(
    root,
    "docs/archive/old-document.md",
    "> Archived for history; not maintained.\n\n# Old document\n",
  );
  return root;
}

function write(root: string, name: string, content: string) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("check-docs", () => {
  it("accepts a complete indexed documentation tree", () => {
    expect(checkDocs({ root: fixture() })).toEqual([]);
  });

  it("fails when an active docs file is not reachable from docs/README.md", () => {
    const root = fixture();
    write(root, "docs/adr/orphan-note.md", "# Orphan note\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "active docs file is not reachable",
    );
  });

  it("fails for a broken relative link", () => {
    const root = fixture();
    write(
      root,
      "README.md",
      "# English guide\n\n## Provider\n\n[missing](./absent.md)\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      'broken relative link "./absent.md"',
    );
  });

  it("fails for a broken heading anchor", () => {
    const root = fixture();
    write(root, "README.md", "# English guide\n\n[missing](#not-here)\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      'broken anchor "#not-here"',
    );
  });

  it("fails when an active Markdown filename is not ASCII kebab-case", () => {
    const root = fixture();
    write(root, "docs/adr/Bad Name.md", "# Bad name\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "filename must use ASCII kebab-case",
    );
  });

  it("fails when ADR numbering has a gap", () => {
    const root = fixture();
    write(root, "docs/adr/0003-third.md", "# ADR three\n");
    write(
      root,
      "docs/adr/README.md",
      "# ADR index\n\n[0001](./0001-record.md)\n[0003](./0003-third.md)\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      "ADR numbering must be consecutive",
    );
  });

  it("fails when ADR numbering is duplicated", () => {
    const root = fixture();
    write(root, "docs/adr/0001-another-record.md", "# Another ADR one\n");
    write(
      root,
      "docs/adr/README.md",
      "# ADR index\n\n[one](./0001-record.md)\n[another](./0001-another-record.md)\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain("duplicate ADR numbering");
  });

  it("fails when two documents use the same H1 title", () => {
    const root = fixture();
    write(
      root,
      "README.pt-BR.md",
      "# English guide\n\n## Provider\n\n## Consumer\n\n```sh\nnpm test\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain("H1 title duplicates");
  });

  it("fails when a document has no H1 title", () => {
    const root = fixture();
    write(root, "docs/adr/0002-second.md", "## No H1\n");
    write(
      root,
      "docs/adr/README.md",
      "# ADR index\n\n[0001](./0001-record.md)\n[0002](./0002-second.md)\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      "document is missing an H1 title",
    );
  });

  it("fails for a new root-level Markdown file outside the allowlist", () => {
    const root = fixture();
    write(root, "scratch.md", "# Scratch\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "root-level Markdown file is not in the allowed list",
    );
  });

  it("fails when an archived document has no archive notice", () => {
    const root = fixture();
    write(root, "docs/archive/old-document.md", "# Old document\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "archived document must begin with an archive notice",
    );
  });

  it("fails when an active document links directly to an archived document", () => {
    const root = fixture();
    write(
      root,
      "README.md",
      "# English guide\n\n[Old](./docs/archive/old-document.md)\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      "active documents must link to archived files only through docs/archive/README.md",
    );
  });

  it("warns, but does not fail, when a document exceeds 400 lines", () => {
    const root = fixture();
    const warnings: string[] = [];
    write(
      root,
      "docs/adr/0002-long-record.md",
      `# Long record\n${"text\n".repeat(401)}`,
    );
    write(
      root,
      "docs/adr/README.md",
      "# ADR index\n\n[0001](./0001-record.md)\n[0002](./0002-long-record.md)\n",
    );
    write(
      root,
      "docs/README.md",
      "# Docs\n\n[ADRs](./adr/README.md)\n[Archive](./archive/README.md)\n",
    );
    expect(
      checkDocs({ root, warn: (warning) => warnings.push(warning) }),
    ).toEqual([]);
    expect(warnings.join("\n")).toContain("over 400");
  });

  it("fails when the package version has no matching changelog section", () => {
    const root = fixture();
    write(root, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "missing release section for package version 1.0.0",
    );
  });

  it("fails when README H2 sections are out of parity", () => {
    const root = fixture();
    write(
      root,
      "README.pt-BR.md",
      "# Guia português\n\n## Consumer\n\n## Provider\n\n```sh\nnpm test\n```\n\n| A | B |\n| --- | --- |\n| x | y |\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      "H2 headings must match README.md in the same order",
    );
  });

  it("fails when README code and table structures differ", () => {
    const root = fixture();
    write(
      root,
      "README.pt-BR.md",
      "# Guia português\n\n## Provider\n\n## Consumer\n\n```sh\nnpm test\n```\n",
    );
    expect(checkDocs({ root }).join("\n")).toContain(
      "code block and table structure must match README.md",
    );
  });

  it("fails when the ADR index omits an existing ADR", () => {
    const root = fixture();
    write(root, "docs/adr/README.md", "# ADR index\n");
    expect(checkDocs({ root }).join("\n")).toContain(
      "ADR index is missing 0001-record.md",
    );
  });
});
