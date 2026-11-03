import type { StepImage } from "../../core/types.ts";
import { call } from "../api.ts";

export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
}

const extOf = (f: File) => {
  const fromName = /\.([a-z0-9]+)$/i.exec(f.name)?.[1];
  return (fromName ?? f.type.split("/")[1] ?? "png").toLowerCase().replace("jpeg", "jpg");
};

export async function uploadImage(testId: string, file: File): Promise<StepImage> {
  const r = await call<StepImage | { image: StepImage }>("tests.storeImage", {
    id: testId,
    name: file.name || `paste.${extOf(file)}`,
    ext: extOf(file),
    dataBase64: await toBase64(file),
  });
  return "image" in r ? r.image : r;
}
