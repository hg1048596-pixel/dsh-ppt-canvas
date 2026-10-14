import { statSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
//#region lib/types/events.js
/** System SSE endpoint pushing graph/rebuilt frames (wire protocol constant). */
const EVENTS_ENDPOINT = "/plugins/events";
EVENTS_ENDPOINT.slice(1);
//#endregion
//#region lib/types/index.js
/**
* Host transport for Web client graph changes and rebuilt bundles. One interval
* stat-polls every graph row's client bundle (polling by design: network mounts
* deliver no inotify events), reports changes through
* `clientModules.rebuilt(id)`, and serves the `/plugins/events` SSE channel
* broadcasting graph/rebuilt frames to the browser half (src/client/).
* The Web composition mounts this transport for live graph updates;
* a development rebuild watcher also supplies bundle changes.
*/
/** Cordis plugin name. */
const name = "client-hmr";
/** Required services: the client graph and Web route registry. */
const inject = ["clientModules", "webServer"];
const Config = z.object({ pollIntervalMs: z.number().step(1).min(1).default(500) });
/** Serialize one frame as an SSE data line. */
function sseData(frame) {
	return `data: ${JSON.stringify(frame)}\n\n`;
}
/** Snapshot the executable bundle metadata that drives reloads. */
function bundleStat(path) {
	const bundle = statSync(path);
	return {
		mtimeMs: bundle.mtimeMs,
		ctimeMs: bundle.ctimeMs,
		size: bundle.size
	};
}
/** Whether the executable bundle metadata is unchanged since its last publication. */
function sameBundleStat(left, right) {
	return left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
}
/**
* Mount bundle watches and graph/rebuilt SSE delivery.
* @param ctx - host plugin context carrying clientModules and webServer.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const pollIntervalMs = config.pollIntervalMs;
	const watched = /* @__PURE__ */ new Map();
	const publish = (id, watch, current) => {
		try {
			ctx.clientModules.rebuilt(id);
		} catch (error) {
			if (error.code === "ENOENT") {
				watch.dirty = true;
				return;
			}
			ctx.logger.warn(error);
		}
		watch.mtimeMs = current.mtimeMs;
		watch.ctimeMs = current.ctimeMs;
		watch.size = current.size;
		watch.dirty = false;
	};
	const watchRow = (id, baseline) => {
		const watch = {
			...baseline,
			dirty: false
		};
		watched.set(id, watch);
		let current;
		try {
			current = bundleStat(baseline.path);
		} catch (error) {
			watch.dirty = true;
			if (error.code !== "ENOENT") ctx.logger.warn(error);
			return;
		}
		if (!sameBundleStat(current, watch)) publish(id, watch, current);
	};
	const pollWatches = () => {
		for (const [id, watch] of watched) {
			let current;
			try {
				current = bundleStat(watch.path);
			} catch (error) {
				watch.dirty = true;
				if (error.code !== "ENOENT") ctx.logger.warn(error);
				continue;
			}
			if (!watch.dirty && sameBundleStat(current, watch)) continue;
			publish(id, watch, current);
		}
	};
	const syncWatches = () => {
		const rows = /* @__PURE__ */ new Map();
		for (const row of ctx.clientModules.graph().entries) {
			const watch = ctx.clientModules.artifactBaseline(row.id);
			if (watch !== void 0) rows.set(row.id, watch);
		}
		for (const [id, watch] of watched) {
			if (rows.get(id)?.path === watch.path) continue;
			watched.delete(id);
		}
		for (const [id, watch] of rows) if (!watched.has(id)) watchRow(id, watch);
	};
	ctx.effect(() => {
		syncWatches();
		const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
		const timer = setInterval(pollWatches, pollIntervalMs);
		timer.unref();
		return () => {
			unsubscribe();
			clearInterval(timer);
			watched.clear();
		};
	}, "client-hmr: bundle watches");
	const connections = /* @__PURE__ */ new Set();
	const publishGraph = () => {
		const line = sseData({
			type: "graph",
			graph: ctx.clientModules.graph()
		});
		for (const res of connections) res.write(line);
	};
	const connect = (res) => {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			"connection": "keep-alive"
		});
		res.write(": connected\n\n");
		connections.add(res);
		res.write(sseData({
			type: "graph",
			graph: ctx.clientModules.graph()
		}));
		res.on("close", () => {
			connections.delete(res);
		});
	};
	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: "exact",
			path: EVENTS_ENDPOINT,
			handler: (req, res) => {
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405);
					res.end();
					return;
				}
				connect(res);
			}
		});
		const unsubscribeGraph = ctx.clientModules.onGraphChanged(publishGraph);
		const unsubscribe = ctx.clientModules.onRebuilt((id, rev) => {
			const line = sseData({
				type: "rebuilt",
				id,
				rev
			});
			for (const res of connections) res.write(line);
		});
		return () => {
			unsubscribeGraph();
			unsubscribe();
			disposeRoute();
			for (const res of connections) res.destroy();
			connections.clear();
		};
	}, "client-hmr: /plugins/events channel");
}
//#endregion
export { Config, EVENTS_ENDPOINT, apply, inject, name };
