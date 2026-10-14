/**
 * 生图收件箱：生成成功后自动把图片上传到指定的 GitHub 收件仓库。
 * 上传者名字只生成一次存浏览器，朋友无需任何配置。
 */

const INBOX_REPO = "wodeshijie1234/image-inbox";
// 钥匙在构建时注入（见 .env.production / VITE_INBOX_TOKEN），
// 只对 image-inbox 这个仓库有读写权限，泄露风险限于这一个仓库。
const INBOX_TOKEN = import.meta.env.VITE_INBOX_TOKEN ?? "";

const UPLOADER_KEY = "openai-image-webui:inbox-uploader";

export function getUploaderName(): string {
  try {
    const saved = localStorage.getItem(UPLOADER_KEY);
    if (saved) {
      return saved;
    }

    const name = `朋友-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(UPLOADER_KEY, name);
    return name;
  } catch {
    return "朋友";
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("read blob failed"));
    reader.readAsDataURL(blob);
  });
}

function slugify(text: string, max = 20): string {
  const slug = text
    .trim()
    .replace(/[\s/\\:*?"<>|#%&{}$!'@+`=\[\]\u0000-\u001f]+/g, "_")
    .slice(0, max);
  return slug;
}

export interface InboxMeta {
  prompt: string;
  model: string;
}

/**
 * 上传图片到收件仓库。图片路径：uploads/<上传者>/<时间戳>-<提示词摘要>.png
 * 同时附带一个同名 .json 说明文件（提示词、模型、上传时间）。
 * 任何失败都只抛错给调用方，不影响主流程。
 */
export async function sendToInbox(blob: Blob, meta: InboxMeta): Promise<void> {
  if (!INBOX_TOKEN) {
    throw new Error("inbox token not configured");
  }

  const uploader = getUploaderName();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  const promptSlug = slugify(meta.prompt);
  const baseName = stamp + (promptSlug ? `-${promptSlug}` : "") + ".png";
  const baseDir = `uploads/${encodeURIComponent(uploader)}`;

  const content = await blobToBase64(blob);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${INBOX_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const put = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(
      `https://api.github.com/repos/${INBOX_REPO}/contents/${path}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`inbox upload failed: ${response.status} ${text.slice(0, 200)}`);
    }
  };

  await put(`${baseDir}/${encodeURIComponent(baseName)}`, {
    message: `${uploader}: ${meta.prompt.slice(0, 200)}`,
    content,
    branch: "main",
  });

  await put(`${baseDir}/${encodeURIComponent(baseName)}.json`, {
    message: `meta: ${baseName}`,
    content: btoa(
      encodeURIComponent(
        JSON.stringify({ uploader, ...meta, savedAt: now.toISOString() }),
      ),
    ),
    branch: "main",
  });
}

/** 从任务里取出可上传的图片 Blob；取不到就返回 null。 */
export async function taskImageBlob(
  imageUrl: string | undefined,
  b64Json: string | undefined,
): Promise<Blob | null> {
  if (imageUrl) {
    try {
      const response = await fetch(imageUrl);

      if (response.ok) {
        return await response.blob();
      }
    } catch {
      // fall through to b64
    }
  }

  if (b64Json) {
    try {
      const bytes = atob(b64Json);
      const array = new Uint8Array(bytes.length);

      for (let i = 0; i < bytes.length; i += 1) {
        array[i] = bytes.charCodeAt(i);
      }

      return new Blob([array], { type: "image/png" });
    } catch {
      return null;
    }
  }

  return null;
}
