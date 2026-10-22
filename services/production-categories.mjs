export const CATEGORIES = [
  "Feature film",
  "Short film",
  "TV show",
  "Commercial",
  "Play",
  "Trailer",
  "Teaser",
  "Stand-up comedy",
  "SaaS video",
  "Documentary",
  "Music video",
  "Educational",
  "Social video",
  "Video podcast",
  "Other",
];
export function categoryOf(p) {
  const value = p.category || p.format;
  return value === "Movie"
    ? "Feature film"
    : value === "TV episode"
      ? "TV show"
      : CATEGORIES.includes(value)
        ? value
        : "Other";
}
export function savedReference(a) {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    description: a.description,
    prompt: a.prompt,
    imageKey: a.imageKey,
    source: a.source,
    revision: a.revision || 0,
  };
}
