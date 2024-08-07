import type { AstroConfig } from '#astro/@types/astro';
import { createAssetLink } from '#astro/core/render/ssr-element';
import type { ModuleLoader } from '../core/module-loader/index.js';
import { viteID } from '../core/util.js';
import { isBuildableCSSRequest } from './util.js';
import { crawlGraph } from './vite.js';

interface ImportedStyle {
	id: string;
	url: string;
	content: string;
}

/** Given a filePath URL, crawl Vite’s module graph to find all style imports. */
export async function getStylesForURL(
	filePath: URL,
	loader: ModuleLoader,
	base: AstroConfig['base'],
): Promise<{ urls: Set<string>; styles: ImportedStyle[]; crawledFiles: Set<string> }> {
	const importedCssUrls = new Set<string>();
	// Map of url to injected style object. Use a `url` key to deduplicate styles
	const importedStylesMap = new Map<string, ImportedStyle>();
	const crawledFiles = new Set<string>();

	for await (const importedModule of crawlGraph(loader, viteID(filePath), true)) {
		const importedModuleUrl = createAssetLink(importedModule.url, base);
		if (importedModule.file) {
			crawledFiles.add(importedModule.file);
		}
		if (isBuildableCSSRequest(importedModuleUrl)) {
			// In dev, we inline all styles if possible
			let css = '';
			// If this is a plain CSS module, the default export should be a string
			if (typeof importedModule.ssrModule?.default === 'string') {
				css = importedModule.ssrModule.default;
			}
			// Else try to load it
			else {
				const url = new URL(importedModuleUrl, 'http://localhost');
				// Mark url with ?inline so Vite will return the CSS as plain string, even for CSS modules
				url.searchParams.set('inline', '');
				const modId = `${decodeURI(url.pathname)}${url.search}`;

				try {
					// The SSR module is possibly not loaded. Load it if it's null.
					const ssrModule = await loader.import(modId);
					css = ssrModule.default;
				} catch {
					// Some CSS modules, e.g. from Vue files, may not work with the ?inline query.
					// If so, we fallback to a url instead
					if (modId.includes('.module.')) {
						importedCssUrls.add(importedModuleUrl);
					}
					// The module may not be inline-able, e.g. SCSS partials. Skip it as it may already
					// be inlined into other modules if it happens to be in the graph.
					continue;
				}
			}

			importedStylesMap.set(importedModuleUrl, {
				id: importedModule.id ?? importedModuleUrl,
				url: importedModuleUrl,
				content: css,
			});
		}
	}

	return {
		urls: importedCssUrls,
		styles: [...importedStylesMap.values()],
		crawledFiles,
	};
}
