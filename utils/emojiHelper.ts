import { emojilib } from "./slack_emoji_map.json";

/**
 * Interface representing emoji metadata
 */
interface EmojiData {
	/** The emoji name/shortcode */
	name: string;
	/** Unicode codepoint for the emoji */
	unicode: string;
	/** Unique identifier */
	id: string;
	/** Associated keywords/tags */
	keywords: string[];
}

/**
 * Maps emoji names to their Unicode codepoints
 */
class EmojiMap {
	private nameToCodepoint: Map<string, string>;

	/**
	 * Creates a new EmojiMap
	 * @param emojiData Array of emoji metadata
	 */
	constructor(emojiData: EmojiData[]) {
		this.nameToCodepoint = new Map();
		for (const emoji of emojiData) {
			this.nameToCodepoint.set(emoji.name, emoji.unicode);
		}
	}

	/**
	 * Gets the Unicode codepoint for an emoji name
	 * @param name The emoji name/shortcode
	 * @returns The Unicode codepoint, or undefined if not found
	 */
	getCodepoint(name: string): string | undefined {
		return this.nameToCodepoint.get(name);
	}
}

const emojiMap = new EmojiMap(emojilib);

/** Slack bumps this when it ships a new emoji asset set */
const ASSET_VERSION = "16.0";
const ASSET_STYLE = "google-xlarge";

/**
 * Gets the Slack CDN URL for an emoji
 * @param keyword The emoji name/shortcode
 * @returns The CDN URL, or null if emoji not found
 */
export function getEmojiUrl(keyword: string): string | null {
	const codepoint = emojiMap.getCodepoint(keyword.toLowerCase());
	if (!codepoint) return null;

	return `https://a.slack-edge.com/production-standard-emoji-assets/${ASSET_VERSION}/${ASSET_STYLE}/${codepoint.toLowerCase()}.png`;
}
