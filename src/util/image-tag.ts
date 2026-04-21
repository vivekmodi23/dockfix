export function dockerSafeTag(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "app";
}
