// Checks (default) or rewrites (--write) the download tables of README.md and its translations against the
// Windows TOOLS of crates/vs-server/src/tools.rs. A table sits between <!-- downloads:start --> and
// <!-- downloads:end -->; a README without the markers is skipped.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- downloads:start -->";
const END = "<!-- downloads:end -->";

const FILES = {
  en: "README.md",
  ru: "README.ru.md",
  zh: "README.zh.md",
  es: "README.es.md",
  fr: "README.fr.md",
  pt: "README.pt.md",
};

const TEXT = {
  en: {
    head: ["Tool", "What for", "File (direct link)", "Size", "Where it goes"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importing a video by its link", ffmpeg: "joining a linked video's picture and sound" },
    put: { None: "as is", Flat: "unpacked", Pick: "ffmpeg.exe and ffprobe.exe of the archive" },
  },
  ru: {
    head: ["Инструмент", "Зачем", "Файл (прямая ссылка)", "Размер", "Куда"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "импорт видео по ссылке", ffmpeg: "склейка картинки и звука видео по ссылке" },
    put: { None: "как есть", Flat: "распакованным", Pick: "ffmpeg.exe и ffprobe.exe из архива" },
  },
  zh: {
    head: ["工具", "用途", "文件（直接链接）", "大小", "存放位置"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "通过链接导入视频", ffmpeg: "合并链接视频的画面和声音" },
    put: { None: "原样", Flat: "解压后", Pick: "压缩包中的 ffmpeg.exe 和 ffprobe.exe" },
  },
  es: {
    head: ["Herramienta", "Para qué", "Archivo (enlace directo)", "Tamaño", "Dónde va"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importar un vídeo por su enlace", ffmpeg: "unir la imagen y el sonido de un vídeo enlazado" },
    put: { None: "tal cual", Flat: "descomprimido", Pick: "ffmpeg.exe y ffprobe.exe del archivo" },
  },
  fr: {
    head: ["Outil", "À quoi il sert", "Fichier (lien direct)", "Taille", "Où il va"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importer une vidéo par son lien", ffmpeg: "réunir l'image et le son d'une vidéo liée" },
    put: { None: "tel quel", Flat: "décompressé", Pick: "ffmpeg.exe et ffprobe.exe de l'archive" },
  },
  pt: {
    head: ["Ferramenta", "Para quê", "Arquivo (link direto)", "Tamanho", "Para onde vai"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importar um vídeo pelo link", ffmpeg: "juntar a imagem e o som de um vídeo por link" },
    put: { None: "como está", Flat: "descompactado", Pick: "ffmpeg.exe e ffprobe.exe do arquivo" },
  },
};

/** The Windows tools of tools.rs: each id with its files' address, place, size and how it is unpacked. */
function windowsTools() {
  const source = readFileSync(join(root, "crates/vs-server/src/tools.rs"), "utf8");
  const start = source.indexOf("#[cfg(windows)]\nconst TOOLS");
  const end = source.indexOf('#[cfg(target_os = "linux")]\nconst TOOLS');
  if (start < 0 || end < start) throw new Error("[ERROR] the Windows TOOLS of tools.rs were not found");
  const block = source.slice(start, end);
  const tools = [];
  for (const part of block.split("ToolSpec {").slice(1)) {
    const id = part.match(/id: "([^"]+)"/)?.[1];
    const files = [...part.matchAll(/url: "([^"]+)",\s*dest: "([^"]+)",\s*size: ([\d_]+),[\s\S]*?extract: Extract::(\w+)/g)].map((m) => ({
      url: m[1],
      dest: m[2],
      size: Number(m[3].replace(/_/g, "")),
      extract: m[4],
    }));
    if (!id || files.length === 0) throw new Error(`[ERROR] a tool of tools.rs could not be read: ${part.slice(0, 80)}`);
    tools.push({ id, files });
  }
  return tools;
}

const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function table(lang, tools) {
  const text = TEXT[lang];
  const rows = tools.flatMap((tool) =>
    tool.files.map((file, index) => {
      const name = file.url.split("/").at(-1);
      const folder = file.dest.replace(/\/[^/]+$/, "/");
      const first = index === 0;
      return `| ${first ? text.tool[tool.id] : ""} | ${first ? text.use[tool.id] : ""} | [${name}](${file.url}) | ${megabytes(file.size)} | \`data\\${folder.replace(/\//g, "\\")}\` (${text.put[file.extract]}) |`;
    }),
  );
  return [`| ${text.head.join(" | ")} |`, `|${text.head.map(() => "---").join("|")}|`, ...rows].join("\n");
}

const write = process.argv.includes("--write");
const tools = windowsTools();
let stale = 0;
for (const [lang, name] of Object.entries(FILES)) {
  const path = join(root, name);
  if (!existsSync(path)) continue;
  const readme = readFileSync(path, "utf8");
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from < 0 || to < from) continue;
  const next = `${readme.slice(0, from + START.length)}\n${table(lang, tools)}\n${readme.slice(to)}`;
  if (next === readme) continue;
  if (write) {
    writeFileSync(path, next);
    console.log(`[OK] ${name} rewritten`);
  } else {
    stale++;
    console.log(`[ERROR] ${name}: the download table is not that of tools.rs; run node scripts/readme-downloads.mjs --write`);
  }
}
if (stale > 0) process.exit(1);
console.log("[OK] download tables");
