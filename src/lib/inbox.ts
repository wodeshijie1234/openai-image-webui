/**
 * 生图收件箱：生成成功后自动把图片上传到收件中转站。
 * 中转站负责用服务端密钥写入 GitHub 收件仓库，本文件不含任何密钥。
 * 上传者名字只生成一次存浏览器，朋友无需任何配置。
 */

const RELAY_URL = "https://image-inbox-relay.app.workbuddy.host";

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

export interface InboxMeta {
  prompt: string;
  model: string;
}

/**
 * 上传图片到收件中转站。任何失败都只抛错给调用方，不影响主流程。
 */
export async function sendToInbox(blob: Blob, meta: InboxMeta): Promise<void> {
  const uploader = getUploaderName();
  // HTTP 头只认 ASCII，中文一律 base64 传输（UTF-8）
  const toB64 = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  };
  const promptB64 = toB64(meta.prompt);

  const response = await fetch(`${RELAY_URL}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "image/png",
      "x-uploader-b64": toB64(uploader),
      "x-model": meta.model,
      "x-prompt-b64": promptB64,
    },
    body: blob,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`inbox upload failed: ${response.status} ${text.slice(0, 200)}`);
  }
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
