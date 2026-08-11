import emojiMap from "./slack_emoji_map.json";

/** Slack bumps this when it ships a new emoji asset set */
const ASSET_VERSION = "16.0";
const ASSET_STYLE = "google-xlarge";

const codepoints: Record<string, string | undefined> = emojiMap;

/**
 * Gets the Slack CDN URL for a standard emoji
 * @param keyword The emoji name/shortcode
 * @returns The CDN URL, or null if emoji not found
 */
export function getEmojiUrl(keyword: string): string | null {
	const codepoint = codepoints[keyword.toLowerCase()];
	if (!codepoint) return null;

	return `https://a.slack-edge.com/production-standard-emoji-assets/${ASSET_VERSION}/${ASSET_STYLE}/${codepoint}.png`;
}
