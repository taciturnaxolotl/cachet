/**
 * Regenerates utils/slack_emoji_map.json from iamcal/emoji-data.
 *
 * Slack's emoji picker is built on this dataset (Cal Henderson was Slack's CTO),
 * so the short names and codepoints line up with the CDN filenames exactly.
 * The dataset version tracks the CDN asset version: emoji-datasource 16.0.0
 * matches .../production-standard-emoji-assets/16.0/, so we write the derived
 * asset version into the map rather than letting the two drift apart.
 *
 * Usage: bun run scripts/build-emoji-map.ts [version]
 */

const VERSION = process.argv[2] ?? "16.0.0";
const ASSET_VERSION = VERSION.split(".").slice(0, 2).join(".");
const SOURCE = `https://unpkg.com/emoji-datasource@${VERSION}/emoji.json`;
const OUT = `${import.meta.dir}/../utils/slack_emoji_map.json`;

interface DatasourceEmoji {
	unified: string;
	short_names: string[];
}

const response = await fetch(SOURCE);
if (!response.ok) {
	throw new Error(`${SOURCE} returned ${response.status}`);
}

const emoji = (await response.json()) as DatasourceEmoji[];

// Prototype-free so short names like `constructor` behave as plain keys
const map: Record<string, string> = Object.create(null);
for (const { short_names, unified } of emoji) {
	for (const name of short_names) {
		map[name.toLowerCase()] ??= unified.toLowerCase();
	}
}

const sorted = Object.fromEntries(
	Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

await Bun.write(
	OUT,
	`${JSON.stringify({ assetVersion: ASSET_VERSION, emoji: sorted }, null, "\t")}\n`,
);
console.log(
	`wrote ${Object.keys(sorted).length} names to ${OUT} from emoji-datasource@${VERSION}`,
);
