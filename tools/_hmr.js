import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, join, relative, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { watch } from "chokidar";
import { Inject, Service } from "@deepseek-ai/cordis";
import { readFileSync, realpathSync } from "node:fs";
import { PROFILE_PATCH_FILENAME, readProfileManifest, readProfilePatches, reconcileProfilePatches } from "@deepseek-ai/dsh-app-boot";
import { codeFrameColumns } from "@babel/code-frame";
import { fileURLToPath, pathToFileURL } from "node:url";
import picomatch from "picomatch";
import z from "@deepseek-ai/schemastery";
//#region lib/types/watch-config.js
/** Exact-path watching for live profile patch files outside Cordis module roots. */
const registrations = /* @__PURE__ */ new WeakMap();
async function findWatchRoot(filename) {
	let root = dirname(filename);
	let depth = 0;
	while (true) try {
		if (!(await stat(root)).isDirectory()) throw new Error(`config watch parent is not a directory: ${root}`);
		const canonicalRoot = await realpath(root);
		return {
			filename: resolve(canonicalRoot, relative(root, filename)),
			root: canonicalRoot,
			depth
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		const parent = dirname(root);
		if (parent === root) throw error;
		root = parent;
		depth += 1;
	}
}
/**
* Watch one patch path, including missing parents, and serialize refresh callbacks.
* @param ctx Context that owns watcher disposal and receives refresh failures.
* @param filename Absolute patch-file path.
* @param options Deployment watcher options; configuration watches enable write stabilization by default.
* @param refresh Callback for additions, changes, and removals.
* @param inTransaction Whether disposal is running inside the refresh being removed.
* @returns A disposer that closes the watcher and drains its current refresh.
* @throws When path resolution, watcher startup, or effect registration fails.
*/
async function watchConfig(ctx, filename, options, refresh, inTransaction = () => false) {
	const target = await findWatchRoot(filename);
	const paths = registrations.get(ctx) ?? /* @__PURE__ */ new Set();
	registrations.set(ctx, paths);
	if (paths.has(target.filename)) throw new Error(`config path already registered: ${filename}`);
	const { cwd: _cwd, ignored: _ignored, ...watchOptions } = options;
	const watcher = watch(target.root, {
		awaitWriteFinish: true,
		...watchOptions,
		depth: target.depth,
		ignoreInitial: false
	});
	paths.add(target.filename);
	const state = { dirty: false };
	let running;
	const onChange = (path) => {
		const observed = resolve(path);
		if (observed !== filename && observed !== target.filename) return;
		state.dirty = true;
		if (running) return;
		running = (async () => {
			while (state.dirty) {
				state.dirty = false;
				try {
					await refresh();
				} catch (reason) {
					const error = reason instanceof Error ? reason : new Error(String(reason), { cause: reason });
					ctx.logger.warn("config reload at %C failed", filename);
					ctx.logger.warn(error);
				}
			}
		})().finally(() => {
			running = void 0;
		});
	};
	watcher.on("add", onChange);
	watcher.on("change", onChange);
	watcher.on("unlink", onChange);
	const ready = Promise.withResolvers();
	let pending = true;
	watcher.once("ready", () => {
		pending = false;
		ready.resolve();
	});
	watcher.on("error", (error) => {
		if (pending) {
			pending = false;
			ready.reject(error);
		} else ctx.logger.warn(error);
	});
	const dispose = async () => {
		await watcher.close();
		paths.delete(target.filename);
		if (!inTransaction()) await running;
	};
	try {
		await ready.promise;
		return ctx.effect(() => dispose, "hmr.watchConfig()");
	} catch (error) {
		await dispose();
		throw error;
	}
}
//#endregion
//#region lib/types/error.js
function isBuildFailure(e) {
	return e !== null && typeof e === "object" && "errors" in e && Array.isArray(e.errors) && e.errors.every((error) => error !== null && typeof error === "object" && "text" in error && typeof error.text === "string");
}
/** Log HMR build failures with code frames when source locations are available.
* @param ctx Context owning reload diagnostics.
* @param e Failure from the module loader or compiler.
*/
function handleError(ctx, e) {
	if (!isBuildFailure(e)) {
		ctx.logger.warn(e);
		return;
	}
	for (const error of e.errors) {
		if (!error.location) {
			ctx.logger.warn(error.text);
			continue;
		}
		try {
			const { file, line, column } = error.location;
			const formatted = codeFrameColumns(readFileSync(file, "utf8"), { start: {
				line,
				column
			} }, {
				highlightCode: true,
				message: error.text
			});
			ctx.logger.warn(`File: ${file}:${line}:${column}\n` + formatted);
		} catch (e) {
			ctx.logger.warn(e);
		}
	}
}
//#endregion
//#region lib/types/index.js
/** Serialized module and profile-configuration reloads. */
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
function canonicalPath(filename) {
	try {
		return realpathSync(filename);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		const parent = dirname(filename);
		if (parent === filename) throw error;
		return resolve(canonicalPath(parent), basename(filename));
	}
}
/**
* Recursively collect all module dependencies from a ModuleJob.
* Skips node: builtins and node_modules to focus on user code.
*/
async function loadDependencies(job, ignored = /* @__PURE__ */ new Set()) {
	const dependencies = /* @__PURE__ */ new Set();
	async function traverse(job) {
		if (ignored.has(job.url) || dependencies.has(job.url)) return;
		if (job.url.startsWith("node:") || job.url.includes("/node_modules/")) return;
		dependencies.add(job.url);
		const children = await job.linked;
		await Promise.all(Array.prototype.map.call(children, traverse));
	}
	await traverse(job);
	return dependencies;
}
/** Hot reload service with Cordis-compatible module configuration and events. */
let Hmr = (() => {
	let _classDecorators = [Inject("loader"), Inject("timer")];
	let _classDescriptor;
	let _classExtraInitializers = [];
	let _classThis;
	let _classSuper = Service;
	var Hmr = class extends _classSuper {
		static {
			_classThis = this;
		}
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			__esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, {
				kind: "class",
				name: _classThis.name,
				metadata: _metadata
			}, null, _classExtraInitializers);
			Hmr = _classThis = _classDescriptor.value;
			if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		config;
		/** Cordis-compatible watcher defaults. */
		static Config = z.object({
			base: z.string(),
			root: z.array(String).role("table").default(["."]),
			ignored: z.array(String).role("table").default([
				"**/node_modules",
				"**/.*",
				"cache",
				"data"
			]),
			debounce: z.natural().role("ms").default(100)
		});
		/** Absolute base directory used to resolve module watch roots. */
		baseDir;
		ownerContext;
		internal;
		watcher;
		/**
		* Changes from externals will always trigger a full reload.
		* Externals are the dependency tree of the CLI worker entry point.
		*/
		externals;
		/**
		* Files that should be reloaded (accepted changes).
		* Includes all stashed files and their dependents.
		*/
		accepted;
		/**
		* Files that should NOT be reloaded.
		* Includes externals and files whose dependents are all declined.
		*/
		declined;
		/** Stashed file changes waiting to be processed */
		stashed = /* @__PURE__ */ new Set();
		operations = Promise.resolve();
		executing = new AsyncLocalStorage();
		applicationReady = Promise.resolve(true);
		closing = false;
		configPaths = /* @__PURE__ */ new Set();
		/** Serialize a caller-owned mutation with all automatic reload paths.
		* @param operation Work that must not overlap module or configuration replacement.
		* @returns The operation result after its asynchronous work completes.
		*/
		runExclusive(operation) {
			if (this.executing.getStore()) return Promise.reject(/* @__PURE__ */ new Error("HMR transactions cannot be nested"));
			const task = this.operations.then(async () => {
				if (this.closing) throw new Error("HMR is disposed");
				return this.executing.run(true, operation);
			});
			this.operations = task.catch(() => {});
			return task;
		}
		runReload(operation) {
			return this.runExclusive(async () => {
				if (await this.applicationReady) await operation();
			});
		}
		/** Watch a configuration path through the same queue as module replacement.
		* @param filename Absolute path, which may not exist yet.
		* @param refresh Rebuilds configuration from its current files and awaits Loader completion.
		* @returns Disposer closing this registration and waiting for its pending refresh.
		*/
		async watchConfig(filename, refresh) {
			const paths = [resolve(filename), canonicalPath(filename)];
			if (paths.some((path) => this.configPaths.has(path))) throw new Error(`config path already registered: ${filename}`);
			for (const path of paths) this.configPaths.add(path);
			try {
				const dispose = await this.executing.exit(() => watchConfig(this.ownerContext, filename, this.config, () => this.runReload(refresh), () => this.executing.getStore() === true));
				return async () => {
					await dispose();
					for (const path of paths) this.configPaths.delete(path);
				};
			} catch (error) {
				for (const path of paths) this.configPaths.delete(path);
				throw error;
			}
		}
		constructor(ctx, config) {
			super(ctx, "hmr");
			this.config = config;
			this.ownerContext = ctx;
			if (!this.ctx.loader.internal) throw new Error("--expose-internals is required for HMR service");
			this.internal = this.ctx.loader.internal;
			this.baseDir = fileURLToPath(new URL(config.base || ".", ctx.baseUrl));
		}
		/**
		* Resolve a module specifier to a URL, compatible with Node 22-24.
		*/
		async _resolve(specifier, parentURL, attrs) {
			switch (this.internal.version) {
				case "v1": return await this.internal.resolve(specifier, parentURL, attrs);
				case "v2": return this.internal.resolveSync(parentURL, {
					specifier,
					attributes: attrs
				});
			}
		}
		async *[Service.init]() {
			yield async () => {
				this.closing = true;
				await this.watcher?.close();
				if (!this.executing.getStore()) await this.operations;
			};
			const profile = this.ownerContext.get("profileContext");
			if (profile !== void 0) {
				const ready = this.ownerContext.get("appReady");
				if (ready === void 0) throw new Error("Profile HMR requires application readiness");
				const started = Promise.withResolvers();
				this.applicationReady = started.promise;
				const unsubscribe = ready.onReady(() => {
					started.resolve(true);
				});
				yield () => {
					unsubscribe();
					started.resolve(false);
					return Promise.resolve();
				};
				const manifestPath = join(profile.dir, "package.json");
				const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)];
				let lastInputs;
				let lastBundles = JSON.stringify(profile.startedBundles);
				const refresh = async (manifestOnly) => {
					const bundles = JSON.stringify(readProfileManifest("dsh", profile.dir).dsh?.profile?.bundles ?? []);
					if (manifestOnly && bundles === lastBundles) return;
					const inputs = JSON.stringify([bundles, ...patchFiles.map((filename) => {
						try {
							return readFileSync(filename, "utf8");
						} catch (error) {
							if (error.code === "ENOENT") return null;
							throw error;
						}
					})]);
					if (inputs === lastInputs) return;
					const patches = readProfilePatches("dsh", profile);
					const warnings = await reconcileProfilePatches(this.ownerContext.root, patches, "dsh");
					lastInputs = inputs;
					lastBundles = bundles;
					for (const diagnostic of warnings) this.ctx.logger.warn(diagnostic);
				};
				for (const filename of patchFiles) await this.watchConfig(filename, () => refresh(false));
				await this.watchConfig(manifestPath, () => refresh(true));
			}
			const { loader } = this.ctx;
			const { root, ignored } = this.config;
			if (!this.config.base) this.ctx.logger.info("watching %o", root);
			else this.ctx.logger.info("watching %o in %s", root, this.baseDir);
			const match = picomatch(ignored);
			const watchBaseDir = realpathSync(this.baseDir);
			const mainJob = process.argv[1] === void 0 ? void 0 : this.internal.loadCache.get(pathToFileURL(resolve(process.argv[1])).href);
			if (mainJob) this.externals = await loadDependencies(mainJob);
			else this.externals = /* @__PURE__ */ new Set();
			this.watcher = watch(root, {
				...this.config,
				cwd: watchBaseDir,
				ignored: (path) => match(relative(watchBaseDir, path)),
				ignoreInitial: true
			});
			const changed = /* @__PURE__ */ new Set();
			const dispatch = this.ctx.debounce(() => {
				this.runExclusive(async () => {
					if (!await this.applicationReady) return;
					const batch = [...changed];
					changed.clear();
					const includes = /* @__PURE__ */ new Set();
					let fullReload = false;
					for (const path of batch) {
						const filename = canonicalPath(resolve(watchBaseDir, path));
						const configuredFilename = resolve(this.baseDir, path);
						if (this.configPaths.has(filename) || this.configPaths.has(configuredFilename)) continue;
						const url = pathToFileURL(filename).href;
						if (this.externals.has(url)) {
							fullReload = true;
							continue;
						}
						if (this.internal.loadCache.has(url)) {
							this.stashed.add(url);
							continue;
						}
						const include = [...loader.entries()].map((entry) => entry.subtree).find((tree) => tree?.filename === filename || tree?.filename === configuredFilename);
						if (include !== void 0) includes.add(include);
						else this.ctx.emit("hmr/change", url);
					}
					if (!fullReload && includes.size === 0 && this.stashed.size === 0) return;
					if (fullReload) {
						loader.exit();
						return;
					}
					for (const include of includes) await include.refresh();
					if (this.stashed.size > 0) try {
						await this.partialReload();
					} finally {
						this.stashed.clear();
					}
					await loader.await();
				}).catch((error) => {
					this.ctx.logger.warn(error);
				});
			}, this.config.debounce);
			this.watcher.on("change", (path) => {
				changed.add(path);
				dispatch();
			});
			const ready = Promise.withResolvers();
			let readyState = root.length === 0 ? "resolved" : "pending";
			if (root.length === 0) ready.resolve();
			else this.watcher.once("ready", () => {
				readyState = "resolved";
				ready.resolve();
			});
			this.watcher.on("error", (error) => {
				if (readyState === "pending") {
					readyState = "rejected";
					ready.reject(error);
				} else this.ctx.logger.warn(error);
			});
			await ready.promise;
		}
		/** Omit internal HMR frames from module import diagnostics.
		* @returns The preserved outer stack frames.
		*/
		getOuterStack = () => [];
		/** Read direct module dependency URLs from the active Node loader.
		* @param url Module URL.
		* @returns Linked module URLs, or an empty list for an uncached module.
		*/
		async getLinked(url) {
			const job = this.internal.loadCache.get(url);
			if (!job) return [];
			const linked = await job.linked;
			return Array.prototype.map.call(linked, (job) => job.url);
		}
		/**
		* Classify changed files into accepted (should reload) and declined (should not).
		*
		* A file is accepted if it's directly changed (stashed) or if any of its
		* dependents are accepted. A file is declined if all its dependents are
		* declined or if it's an external.
		*/
		async analyzeChanges() {
			const pending = [];
			this.accepted = new Set(this.stashed);
			this.declined = new Set(this.externals);
			const isExcluded = (url) => url.startsWith("node:") || url.includes("/node_modules/");
			await Promise.all([...this.stashed].map(async (url) => {
				const children = await this.getLinked(url);
				for (const child of children) {
					if (this.accepted.has(child) || this.declined.has(child) || isExcluded(child)) continue;
					pending.push(child);
				}
			}));
			while (pending.length) {
				let index = 0, hasUpdate = false;
				while (index < pending.length) {
					const url = pending[index];
					const children = await this.getLinked(url);
					let isDeclined = true, isAccepted = false;
					for (const child of children) {
						if (this.declined.has(child) || isExcluded(child)) continue;
						if (this.accepted.has(child)) {
							isAccepted = true;
							break;
						} else {
							isDeclined = false;
							if (!pending.includes(child)) {
								hasUpdate = true;
								pending.push(child);
							}
						}
					}
					if (isAccepted || isDeclined) {
						hasUpdate = true;
						pending.splice(index, 1);
						if (isAccepted) this.accepted.add(url);
						else this.declined.add(url);
					} else index++;
				}
				if (!hasUpdate) break;
			}
			for (const url of pending) this.declined.add(url);
		}
		async partialReload() {
			await this.analyzeChanges();
			const pending = /* @__PURE__ */ new Map();
			const reloads = /* @__PURE__ */ new Map();
			const nameMap = /* @__PURE__ */ new Map();
			for (const entry of this.ctx.loader.entries()) {
				const baseUrl = entry.parent.tree.ctx.baseUrl;
				if (baseUrl === void 0) throw new Error("HMR entry tree has no base URL");
				const names = nameMap.get(baseUrl) ?? /* @__PURE__ */ new Set();
				names.add(entry.options.name);
				nameMap.set(baseUrl, names);
			}
			for (const [baseUrl, names] of nameMap) for (const name of names) try {
				const { url } = await this._resolve(name, baseUrl, {});
				if (this.declined.has(url)) continue;
				const job = this.internal.loadCache.get(url);
				const plugin = this.ctx.loader.unwrapExports(job?.module?.getNamespace());
				if (!job || !plugin) continue;
				pending.set(job, plugin);
				this.declined.add(url);
			} catch (err) {
				this.ctx.logger.warn(err);
			}
			for (const [job, plugin] of pending) {
				this.declined.delete(job.url);
				const dependencies = [...await loadDependencies(job, this.declined)];
				this.declined.add(job.url);
				if (!dependencies.some((dep) => this.accepted.has(dep))) continue;
				dependencies.forEach((dep) => this.accepted.add(dep));
				reloads.set(plugin, {
					filename: job.url,
					runtime: this.ctx.registry.get(plugin)
				});
			}
			/**
			* Clear module caches for all accepted files before re-importing.
			*
			* We need to clear both:
			* 1. ESM loadCache — managed by Node's internal ModuleLoader
			* 2. CJS Module._cache — for CJS modules that were imported via import()
			*
			* In Node 24, CJS modules loaded via import() appear in both caches.
			* If we only clear loadCache, the CJS cache may serve stale modules.
			*
			* We use Map.prototype methods directly on loadCache because:
			* - In Node 22/23, loadCache is a plain Map<url, ModuleJob>
			* - In Node 24, loadCache is a LoadCache extends Map<url, { [type]: ModuleJob }>
			*   where .delete() only sets the type slot to undefined (doesn't remove the entry)
			* Using Map.prototype.delete ensures complete removal in both versions.
			*/
			const esmBackup = /* @__PURE__ */ new Map();
			const cjsBackup = /* @__PURE__ */ new Map();
			const require = createRequire(import.meta.url);
			for (const filename of this.accepted) {
				const job = Map.prototype.get.call(this.internal.loadCache, filename);
				esmBackup.set(filename, job);
				Map.prototype.delete.call(this.internal.loadCache, filename);
				try {
					const filepath = fileURLToPath(filename);
					if (require.cache[filepath]) {
						cjsBackup.set(filepath, require.cache[filepath]);
						Reflect.deleteProperty(require.cache, filepath);
					}
				} catch {}
			}
			const rollback = () => {
				for (const [filename, job] of esmBackup) Map.prototype.set.call(this.internal.loadCache, filename, job);
				for (const [filepath, module] of cjsBackup) require.cache[filepath] = module;
			};
			const generations = [...reloads].map(([previous, info]) => ({
				...info,
				previous,
				fibers: [...info.runtime?.fibers ?? []].map((fiber) => {
					const entry = fiber.entry?.fiber?.uid === fiber.uid ? fiber.entry : void 0;
					return {
						fiber,
						entry,
						config: entry === void 0 ? fiber._config : entry.options.config
					};
				})
			}));
			const attempts = [];
			try {
				for (const generation of generations) {
					const replacement = this.ctx.loader.unwrapExports(await this.ctx.loader.import(generation.filename, this.getOuterStack));
					attempts.push({
						...generation,
						replacement
					});
				}
			} catch (e) {
				handleError(this.ctx, e);
				rollback();
				throw e;
			}
			const reload = async (plugin, fibers) => {
				const activated = [];
				for (const previousFiber of fibers) {
					if (previousFiber.fiber.parent.fiber.uid === null) continue;
					const fiber = previousFiber.fiber.parent.registry.plugin(plugin, previousFiber.config, this.getOuterStack).ctx.fiber;
					if (previousFiber.entry !== void 0) {
						fiber.entry = previousFiber.entry;
						previousFiber.entry.fiber = fiber;
					}
					activated.push(fiber);
				}
				await Promise.all(activated.map((fiber) => fiber.await()));
			};
			const removed = /* @__PURE__ */ new Set();
			try {
				for (const { previous: plugin, replacement, filename, runtime, fibers } of attempts) {
					if (!runtime) continue;
					const path = relative(this.baseDir, fileURLToPath(filename));
					removed.add(plugin);
					try {
						this.ctx.registry.delete(plugin);
						await Promise.all(fibers.map(({ fiber }) => fiber.await()));
					} catch (err) {
						this.ctx.logger.warn("failed to dispose plugin at %C", path);
						this.ctx.logger.warn(err);
					}
					try {
						await reload(replacement, fibers);
						this.ctx.logger.info("reload plugin at %C", path);
					} catch (err) {
						this.ctx.logger.warn("failed to reload plugin at %C", path);
						this.ctx.logger.warn(err);
						throw err;
					}
				}
			} catch (error) {
				rollback();
				for (const { previous: plugin, replacement, fibers } of attempts) {
					if (!removed.has(plugin)) continue;
					try {
						const replacementFibers = [...this.ctx.registry.get(replacement)?.fibers ?? []];
						this.ctx.registry.delete(replacement);
						await Promise.allSettled(replacementFibers.map((fiber) => fiber.await()));
						await reload(plugin, fibers);
					} catch (err) {
						this.ctx.logger.warn(err);
					}
				}
				throw error;
			}
			await this.ctx.loader.await();
			this.ctx.emit("hmr/reload", reloads);
			this.stashed = /* @__PURE__ */ new Set();
		}
		static {
			__runInitializers(_classThis, _classExtraInitializers);
		}
	};
	return _classThis;
})();
//#endregion
export { Hmr as default };
