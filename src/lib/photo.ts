/** Réduit une photo (bord le plus long ≤ 1600 px, JPEG) avant envoi au serveur. Navigateur uniquement. */
export async function reduirePhoto(f: File, max = 1600): Promise<string> {
  const img = await createImageBitmap(f);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
