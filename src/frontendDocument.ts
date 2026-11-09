export function frontendUrl(assetBase: string, domain: string, channel: string) {
  return `${assetBase}/${encodeURIComponent(domain)}/index.html?channel=${encodeURIComponent(channel)}`;
}
