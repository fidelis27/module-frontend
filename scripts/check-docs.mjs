import { readdirSync, readFileSync, statSync } from "node:fs";
import { error, log, warn as warnConsole } from "node:console";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);
const ROOT_MARKDOWN = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE.md",
]);
const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const KEBAB_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

function walk(directory, predicate = () => true) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        found.push(...walk(path.join(directory, entry.name), predicate));
      }
    } else {
      const file = path.join(directory, entry.name);
      if (predicate(file, entry.name)) found.push(file);
    }
  }
  return found;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function withoutCode(markdown) {
  const lines = markdown.split(/\r?\n/);
  const kept = [];
  let fence = null;
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = marker[1][0];
      continue;
    }
    if (fence && new RegExp(`^\\s*${fence}{3,}\\s*$`).test(line)) {
      fence = null;
      continue;
    }
    if (!fence) kept.push(line);
  }
  return kept.join("\n").replace(/`[^`\n]*`/g, "");
}

function markdownLinks(markdown) {
  const text = withoutCode(markdown);
  const links = [];
  const add = (target) => {
    if (target) links.push(target.replace(/^<|>$/g, ""));
  };
  for (const match of text.matchAll(
    /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/g,
  )) {
    add(match[1]);
  }
  for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)) {
    add(match[1]);
  }
  for (const match of text.matchAll(
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  )) {
    add(match[1]);
  }
  return links;
}

function markdownHeadings(markdown) {
  const lines = withoutCode(markdown).split(/\r?\n/);
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match)
      headings.push({
        level: match[1].length,
        text: match[2],
        line: index + 1,
      });
  }
  return headings;
}

function headingAnchors(markdown) {
  const headings = markdownHeadings(markdown);
  const used = new Map();
  const anchors = new Set();
  for (const heading of headings) {
    let slug = heading.text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    const count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    if (count) slug = `${slug}-${count}`;
    anchors.add(slug);
  }
  for (const match of markdown.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return { headings, anchors };
}

function normalizedLocalTarget(source, target, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return { error: `invalid percent-encoding in link "${target}"` };
  }
  const [pathname, ...fragmentParts] = decoded.split("#");
  const fragment = fragmentParts.length ? fragmentParts.join("#") : null;
  const cleanPath = pathname.split("?")[0];
  const destination = cleanPath
    ? path.resolve(path.dirname(source), cleanPath)
    : source;
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (
    destination !== path.resolve(root) &&
    !destination.startsWith(rootPrefix)
  ) {
    return { error: `link escapes repository: "${target}"` };
  }
  return { destination, fragment };
}

function isExternal(target) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

function collectMarkdown(root) {
  return walk(root, (file, name) => name.toLowerCase().endsWith(".md"));
}

function checkDocs({ root = ROOT, warn = () => {} } = {}) {
  const errors = [];
  const markdownFiles = collectMarkdown(root);
  const contents = new Map(
    markdownFiles.map((file) => [file, readFileSync(file, "utf8")]),
  );
  const docsRoot = path.join(root, "docs");
  const docsIndex = path.join(docsRoot, "README.md");
  const archiveIndex = path.join(docsRoot, "archive", "README.md");
  const adrIndex = path.join(docsRoot, "adr", "README.md");
  const headingsByFile = new Map();
  const titles = new Map();
  const resolvedLinks = new Map();
  const activeDocsLinks = new Map();

  const report = (file, message) =>
    errors.push(`${relative(root, file)}: ${message}`);

  for (const file of markdownFiles) {
    const content = contents.get(file);
    const rel = relative(root, file);
    const basename = path.basename(file);
    const isRoot = path.dirname(file) === path.resolve(root);
    const isReadme = /^README(?:\.[A-Za-z0-9-]+)?\.md$/.test(basename);
    if (isRoot && !isReadme && !ROOT_MARKDOWN.has(basename)) {
      report(file, "root-level Markdown file is not in the allowed list");
    }
    if (!isReadme && !(isRoot && ROOT_MARKDOWN.has(basename))) {
      const inAdr = rel.startsWith("docs/adr/");
      if (
        inAdr
          ? !ADR_FILENAME.test(basename) && basename !== "README.md"
          : !KEBAB_FILENAME.test(basename)
      ) {
        report(
          file,
          "filename must use ASCII kebab-case (ADRs: NNNN-title.md)",
        );
      }
    }

    const headings = markdownHeadings(content);
    headingsByFile.set(file, headingAnchors(content));
    const h1 = headings.filter((heading) => heading.level === 1);
    if (h1.length === 0) {
      report(file, "document is missing an H1 title");
    } else if (h1.length > 1) {
      report(file, "document must have exactly one H1 title");
    } else {
      const title = h1[0].text.trim().toLocaleLowerCase();
      if (titles.has(title)) {
        report(
          file,
          `H1 title duplicates ${relative(root, titles.get(title))}`,
        );
      } else {
        titles.set(title, file);
      }
    }

    const lines = content.split(/\r?\n/).length;
    if (lines > 400) warn(`${rel}: ${lines} lines (over 400)`);

    const resolved = [];
    for (const target of markdownLinks(content)) {
      if (isExternal(target)) continue;
      const parsed = normalizedLocalTarget(file, target, root);
      if (parsed.error) {
        report(file, parsed.error);
        continue;
      }
      let destination = parsed.destination;
      if (statSafe(destination)?.isDirectory()) {
        const candidates = ["README.md", "index.md"].map((name) =>
          path.join(destination, name),
        );
        destination = candidates.find((candidate) => contents.has(candidate));
      }
      if (
        !destination ||
        (!contents.has(destination) && !statSafe(destination))
      ) {
        report(file, `broken relative link "${target}"`);
        continue;
      }
      if (parsed.fragment !== null && contents.has(destination)) {
        const anchors = headingsByFile.get(destination)?.anchors ?? new Set();
        if (!anchors.has(parsed.fragment)) {
          report(
            file,
            `broken anchor "#${parsed.fragment}" in "${relative(root, destination)}"`,
          );
          continue;
        }
      }
      resolved.push(destination);
      if (!rel.startsWith("docs/archive/")) {
        activeDocsLinks.set(file, [
          ...(activeDocsLinks.get(file) ?? []),
          destination,
        ]);
      }
    }
    resolvedLinks.set(file, resolved);
  }

  if (!contents.has(docsIndex)) {
    errors.push("docs/README.md: documentation index is required");
  } else {
    const reachable = new Set();
    const visit = (file) => {
      if (reachable.has(file)) return;
      reachable.add(file);
      for (const destination of resolvedLinks.get(file) ?? []) {
        if (
          contents.has(destination) &&
          destination.startsWith(`${docsRoot}${path.sep}`)
        ) {
          visit(destination);
        }
      }
    };
    visit(docsIndex);
    for (const file of markdownFiles) {
      if (
        file.startsWith(`${docsRoot}${path.sep}`) &&
        !file.startsWith(`${docsRoot}${path.sep}archive${path.sep}`) &&
        !reachable.has(file)
      ) {
        report(file, "active docs file is not reachable from docs/README.md");
      }
    }
  }

  const adrFiles = markdownFiles
    .filter((file) => file.startsWith(`${docsRoot}${path.sep}adr${path.sep}`))
    .filter((file) => /^\d{4}-[a-z0-9-]+\.md$/.test(path.basename(file)))
    .sort();
  const adrNumbers = adrFiles.map((file) =>
    Number(path.basename(file).slice(0, 4)),
  );
  if (new Set(adrNumbers).size !== adrNumbers.length) {
    errors.push("docs/adr: duplicate ADR numbering");
  }
  for (let index = 0; index < adrNumbers.length; index += 1) {
    if (adrNumbers[index] !== index + 1) {
      errors.push(
        "docs/adr: ADR numbering must be consecutive starting at 0001",
      );
      break;
    }
  }

  if (contents.has(adrIndex)) {
    const listed = new Set(
      (resolvedLinks.get(adrIndex) ?? []).filter((file) =>
        adrFiles.includes(file),
      ),
    );
    for (const file of adrFiles) {
      if (!listed.has(file)) {
        report(adrIndex, `ADR index is missing ${path.basename(file)}`);
      }
    }
  } else {
    errors.push("docs/adr/README.md: ADR index is required");
  }

  const packageFile = path.join(root, "package.json");
  const changelog = path.join(root, "CHANGELOG.md");
  if (statSafe(packageFile) && contents.has(changelog)) {
    const version = JSON.parse(readFileSync(packageFile, "utf8")).version;
    if (
      !new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s|$)`, "m").test(
        contents.get(changelog),
      )
    ) {
      report(
        changelog,
        `missing release section for package version ${version}`,
      );
    }
  }

  const readme = path.join(root, "README.md");
  const ptReadme = path.join(root, "README.pt-BR.md");
  if (contents.has(readme) && contents.has(ptReadme)) {
    const h2 = (file) =>
      markdownHeadings(contents.get(file))
        .filter((heading) => heading.level === 2)
        .map((heading) => heading.text);
    if (JSON.stringify(h2(readme)) !== JSON.stringify(h2(ptReadme))) {
      report(ptReadme, "H2 headings must match README.md in the same order");
    }
    const structures = (file) => {
      const fences = [];
      const tables = [];
      let tableRows = 0;
      let inFence = false;
      for (const line of contents.get(file).split(/\r?\n/)) {
        const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (fence) {
          if (inFence) {
            inFence = false;
          } else {
            inFence = true;
            fences.push(fence[2].trim());
          }
          continue;
        }
        if (inFence) continue;
        if (/^\s*\|.*\|\s*$/.test(line)) {
          tableRows += 1;
        } else if (tableRows) {
          tables.push(tableRows);
          tableRows = 0;
        }
      }
      if (tableRows) tables.push(tableRows);
      return { fences, tables };
    };
    if (
      JSON.stringify(structures(readme)) !==
      JSON.stringify(structures(ptReadme))
    ) {
      report(ptReadme, "code block and table structure must match README.md");
    }
  }

  const archiveRoot = path.join(docsRoot, "archive");
  for (const file of markdownFiles.filter((entry) =>
    entry.startsWith(`${archiveRoot}${path.sep}`),
  )) {
    if (file === archiveIndex) continue;
    const notice = contents.get(file).slice(0, 500);
    if (
      !/archived|arquivad[oa]/i.test(notice) ||
      !/not\s+maintained|não\s+mantid[oa]/i.test(notice)
    ) {
      report(
        file,
        "archived document must begin with an archive notice and say it is not maintained",
      );
    }
    for (const [source, destinations] of activeDocsLinks) {
      if (source !== archiveIndex && destinations.includes(file)) {
        report(
          source,
          `active documents must link to archived files only through docs/archive/README.md`,
        );
      }
    }
  }

  return errors;
}

function statSafe(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { checkDocs };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const warnings = [];
  const errors = checkDocs({ warn: (warning) => warnings.push(warning) });
  for (const warning of warnings) warnConsole(`WARN ${warning}`);
  if (errors.length) {
    for (const message of errors) error(`ERROR ${message}`);
    process.exitCode = 1;
  } else {
    log("Documentation checks passed.");
  }
}
