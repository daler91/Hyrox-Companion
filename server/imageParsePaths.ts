const IMAGE_PARSE_PATH_RE =
  /^\/api\/v1\/(?:parse-exercises-from-image|parse-workout-structure-from-image|workouts\/[^/]+\/reparse-from-image|plans\/days\/[^/]+\/reparse-from-image|nutrition\/parse\/(?:photo|label))\/?$/;

export function isImageParsePath(path: string): boolean {
  return IMAGE_PARSE_PATH_RE.test(path);
}
