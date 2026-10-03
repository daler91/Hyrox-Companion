const IMAGE_PARSE_PATH_RE =
  /^\/api\/v1\/(?:parse-exercises-from-image|parse-workout-structure-from-image|workouts\/[^/]+\/reparse-from-image|plans\/days\/[^/]+\/reparse-from-image|nutrition\/parse\/(?:photo|label))\/?$/;

export function isImageParsePath(path: string): boolean {
  return IMAGE_PARSE_PATH_RE.test(path);
}

const CHAT_SEND_PATH_RE = /^\/api\/v1\/chat(?:\/stream)?\/?$/u;

/**
 * The two routes a coach chat message is sent to. A message can carry a photo
 * (CHAT_PHOTO_MAX_BASE64_CHARS of base64), so they get a body parser sized for
 * it instead of the global 100kb one.
 */
export function isChatSendPath(path: string): boolean {
  return CHAT_SEND_PATH_RE.test(path);
}
