import emojiMap from "./slack_emoji_map.json";

const ASSET_STYLE = "google-xlarge";

const { assetVersion, emoji } = emojiMap as {
	assetVersion: string;
	emoji: Record<string, string>;
};

/** A Map keeps names like `constructor` from resolving off Object.prototype */
const codepoints = new Map(Object.entries(emoji));

/**
 * Gets the Slack CDN URL for a standard emoji
 * @param keyword The emoji name/shortcode
 * @returns The CDN URL, or null if emoji not found
 */
export function getEmojiUrl(keyword: string): string | null {
	const codepoint = codepoints.get(keyword.toLowerCase());
	if (!codepoint) return null;

	return `https://a.slack-edge.com/production-standard-emoji-assets/${assetVersion}/${ASSET_STYLE}/${codepoint}.png`;
}
