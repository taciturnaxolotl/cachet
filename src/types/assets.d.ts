/** Bun's file loader resolves these imports to a path on disk */
declare module "*.ico" {
	const path: string;
	export default path;
}
