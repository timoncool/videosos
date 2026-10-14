// Checks (default) or rewrites (--write) the download tables of README.md and its translations against the
// Windows TOOLS of crates/vs-server/src/tools.rs and the engine builds and models of crates/vs-server/src/local.rs.
// A table sits between <!-- downloads:start --> and <!-- downloads:end -->; a README without the markers is skipped.
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
    local: { engine: "stable-diffusion.cpp", Cuda: "local generation on NVIDIA cards", Vulkan: "local generation on other cards", Cpu: "local generation without a card", Image: "pictures on this computer, optional", Video: "video with sound on this computer, optional" },
  },
  ru: {
    head: ["Инструмент", "Зачем", "Файл (прямая ссылка)", "Размер", "Куда"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "импорт видео по ссылке", ffmpeg: "склейка картинки и звука видео по ссылке" },
    put: { None: "как есть", Flat: "распакованным", Pick: "ffmpeg.exe и ffprobe.exe из архива" },
    local: { engine: "stable-diffusion.cpp", Cuda: "локальная генерация на картах NVIDIA", Vulkan: "локальная генерация на других картах", Cpu: "локальная генерация без видеокарты", Image: "картинки на этом компьютере, по желанию", Video: "видео со звуком на этом компьютере, по желанию" },
  },
  zh: {
    head: ["工具", "用途", "文件（直接链接）", "大小", "存放位置"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "通过链接导入视频", ffmpeg: "合并链接视频的画面和声音" },
    put: { None: "原样", Flat: "解压后", Pick: "压缩包中的 ffmpeg.exe 和 ffprobe.exe" },
    local: { engine: "stable-diffusion.cpp", Cuda: "在 NVIDIA 显卡上本地生成", Vulkan: "在其他显卡上本地生成", Cpu: "无显卡本地生成", Image: "在本机生成图片，可选", Video: "在本机生成带声音的视频，可选" },
  },
  es: {
    head: ["Herramienta", "Para qué", "Archivo (enlace directo)", "Tamaño", "Dónde va"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importar un vídeo por su enlace", ffmpeg: "unir la imagen y el sonido de un vídeo enlazado" },
    put: { None: "tal cual", Flat: "descomprimido", Pick: "ffmpeg.exe y ffprobe.exe del archivo" },
    local: { engine: "stable-diffusion.cpp", Cuda: "generación local con tarjetas NVIDIA", Vulkan: "generación local con otras tarjetas", Cpu: "generación local sin tarjeta gráfica", Image: "imágenes en este equipo, opcional", Video: "vídeo con sonido en este equipo, opcional" },
  },
  fr: {
    head: ["Outil", "À quoi il sert", "Fichier (lien direct)", "Taille", "Où il va"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importer une vidéo par son lien", ffmpeg: "réunir l'image et le son d'une vidéo liée" },
    put: { None: "tel quel", Flat: "décompressé", Pick: "ffmpeg.exe et ffprobe.exe de l'archive" },
    local: { engine: "stable-diffusion.cpp", Cuda: "génération locale sur les cartes NVIDIA", Vulkan: "génération locale sur les autres cartes", Cpu: "génération locale sans carte graphique", Image: "images sur cet ordinateur, en option", Video: "vidéo avec son sur cet ordinateur, en option" },
  },
  pt: {
    head: ["Ferramenta", "Para quê", "Arquivo (link direto)", "Tamanho", "Para onde vai"],
    tool: { ytdlp: "yt-dlp + Deno", ffmpeg: "ffmpeg" },
    use: { ytdlp: "importar um vídeo pelo link", ffmpeg: "juntar a imagem e o som de um vídeo por link" },
    put: { None: "como está", Flat: "descompactado", Pick: "ffmpeg.exe e ffprobe.exe do arquivo" },
    local: { engine: "stable-diffusion.cpp", Cuda: "geração local em placas NVIDIA", Vulkan: "geração local em outras placas", Cpu: "geração local sem placa de vídeo", Image: "imagens neste computador, opcional", Video: "vídeo com som neste computador, opcional" },
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

/** The Windows engine builds and the models of local.rs: each with its files' address, place and size. */
function localDownloads() {
  const source = readFileSync(join(root, "crates/vs-server/src/local.rs"), "utf8").replace(/\r\n/g, "\n");
  const download = /Download \{ url: "([^"]+)", dest: "([^"]+)", size: ([\d_]+),[^}]*?unzip_into: (None|Some\("([^"]+)"\))/g;
  const files = (text) => [...text.matchAll(download)].map((m) => ({ url: m[1], dest: m[2], size: Number(m[3].replace(/_/g, "")), unzip: m[5] ?? null }));
  const consts = new Map([...source.matchAll(/^const ([A-Z0-9_]+): ModelFile = ([^\n]+);$/gm)].map((m) => [m[1], files(m[2])[0]]));
  const builds = source.slice(source.indexOf("#[cfg(windows)]\nconst BUILDS"), source.indexOf("#[cfg(not(windows))]\nconst BUILDS"));
  const engines = builds.split("Build {").slice(1).map((part) => ({ device: part.match(/device: Device::(\w+)/)?.[1], files: files(part) }));
  const start = source.indexOf("const MODELS: &[LocalModel] = &[");
  const models = source.slice(start, source.indexOf("\n];", start)).split("LocalModel {").slice(1).map((part) => {
    const all = [...files(part), ...[...consts.keys()].filter((name) => new RegExp(`\\b${name}\\b`).test(part)).map((name) => consts.get(name))];
    const unique = [...new Map(all.map((file) => [file.dest, file])).values()];
    return { name: part.match(/name: "([^"]+)"/)?.[1], kind: part.match(/kind: Kind::(\w+)/)?.[1], files: unique };
  });
  if (engines.length === 0 || models.length === 0 || [...engines, ...models].some((each) => each.files.length === 0 || !(each.device ?? each.name)))
    throw new Error("[ERROR] the engine builds or the models of local.rs could not be read");
  return { engines, models };
}

const megabytes = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

function table(lang, tools, local) {
  const text = TEXT[lang];
  const rows = tools.flatMap((tool) =>
    tool.files.map((file, index) => {
      const name = file.url.split("/").at(-1);
      const folder = file.dest.replace(/\/[^/]+$/, "/");
      const first = index === 0;
      return `| ${first ? text.tool[tool.id] : ""} | ${first ? text.use[tool.id] : ""} | [${name}](${file.url}) | ${megabytes(file.size)} | \`data\\${folder.replace(/\//g, "\\")}\` (${text.put[file.extract]}) |`;
    }),
  );
  const where = (file) => `\`data\\${(file.unzip ?? file.dest.replace(/\/[^/]+$/, "")).replace(/\//g, "\\")}\\\``;
  const link = (file) => `[${file.url.split("/").at(-1)}](${file.url})`;
  const total = (list) => megabytes(list.reduce((sum, file) => sum + file.size, 0));
  for (const engine of local.engines)
    rows.push(`| ${text.local.engine} ${{ Cuda: "CUDA 12", Vulkan: "Vulkan", Cpu: "CPU" }[engine.device]} | ${text.local[engine.device]} | ${engine.files.map(link).join("<br>")} | ${total(engine.files)} | ${where(engine.files[0])} (${text.put.Flat}) |`);
  for (const model of local.models)
    rows.push(`| ${model.name} | ${text.local[model.kind]} | ${model.files.map(link).join("<br>")} | ${total(model.files)} | ${where(model.files[0])} (${text.put.None}) |`);
  return [`| ${text.head.join(" | ")} |`, `|${text.head.map(() => "---").join("|")}|`, ...rows].join("\n");
}

const write = process.argv.includes("--write");
const tools = windowsTools();
const local = localDownloads();
let stale = 0;
for (const [lang, name] of Object.entries(FILES)) {
  const path = join(root, name);
  if (!existsSync(path)) continue;
  const readme = readFileSync(path, "utf8");
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from < 0 || to < from) continue;
  const next = `${readme.slice(0, from + START.length)}\n${table(lang, tools, local)}\n${readme.slice(to)}`;
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
