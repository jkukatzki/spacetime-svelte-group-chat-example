<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import type { DbConnectionBuilder, DbConnectionImpl } from 'spacetimedb';
  import { SpacetimeDBContext, setSpacetimeContext } from './SpacetimeContext.svelte';

  const BUILDER_CONFIG_SYMBOL = Symbol.for('spacetime:builder_config');
  const BUILDER_PATCHED_SYMBOL = Symbol.for('spacetime:builder_patched');

  type AnyBuilder = DbConnectionBuilder<any, any, any> & Record<PropertyKey, any>;

  type BuilderConfig = {
    uri?: string;
    moduleName?: string;
    token?: string;
    compression?: 'gzip' | 'none';
    lightMode?: boolean;
    confirmedReads?: boolean;
  };

  const connectionCache = new Map<string, {
    context: SpacetimeDBContext;
    connection: ReturnType<AnyBuilder['build']>;
    refCount: number;
    disconnectTimer?: ReturnType<typeof setTimeout>;
  }>();

  const remoteModuleIds = new WeakMap<object, string>();
  let remoteModuleCounter = 0;

  function ensureBuilderConfig(builder: AnyBuilder): BuilderConfig {
    if (!builder[BUILDER_CONFIG_SYMBOL]) {
      Object.defineProperty(builder, BUILDER_CONFIG_SYMBOL, {
        value: {} satisfies BuilderConfig,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    }
    return builder[BUILDER_CONFIG_SYMBOL] as BuilderConfig;
  }

  function patchBuilderPrototype() {
    const proto = DbConnectionBuilder.prototype as AnyBuilder;
    if (proto[BUILDER_PATCHED_SYMBOL]) {
      return;
    }

    const wrap = (
      method: keyof AnyBuilder,
      update: (builder: AnyBuilder, args: any[], config: BuilderConfig) => void
    ) => {
      const original = proto[method];
      if (typeof original !== 'function') {
        return;
      }

      proto[method] = function patched(this: AnyBuilder, ...args: any[]) {
        const result = (original as (...args: any[]) => unknown).apply(this, args);
        const config = ensureBuilderConfig(this);
        update(this, args, config);
        return result;
      } as AnyBuilder[keyof AnyBuilder];
    };

    wrap('withUri', (builder, [uri], config) => {
      if (!uri) return;
      const value = uri instanceof URL ? uri.toString() : String(uri);
      config.uri = value;
    });

    wrap('withModuleName', (builder, [moduleName], config) => {
      if (!moduleName) return;
      config.moduleName = String(moduleName);
    });

    wrap('withToken', (builder, [token], config) => {
      config.token = token === undefined ? undefined : String(token);
    });

    wrap('withCompression', (builder, [compression], config) => {
      if (!compression) return;
      config.compression = compression;
    });

    wrap('withLightMode', (builder, [lightMode], config) => {
      config.lightMode = Boolean(lightMode);
    });

    wrap('withConfirmedReads', (builder, [confirmedReads], config) => {
      config.confirmedReads = confirmedReads ?? undefined;
    });

    Object.defineProperty(proto, BUILDER_PATCHED_SYMBOL, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }

  function getRemoteModuleKey(builder: AnyBuilder): string {
    const remoteModule = builder.remoteModule ?? builder['remoteModule'];
    if (!remoteModule) {
      return 'unknown';
    }

    if (!remoteModuleIds.has(remoteModule)) {
      remoteModuleCounter += 1;
      remoteModuleIds.set(remoteModule, `module-${remoteModuleCounter}`);
    }
    return remoteModuleIds.get(remoteModule)!;
  }

  function getConnectionCacheKey(builder: AnyBuilder, explicitKey?: string): string {
    if (explicitKey) {
      return explicitKey;
    }

    const config = ensureBuilderConfig(builder);
    const keyObject = {
      remoteModule: getRemoteModuleKey(builder),
      uri: config.uri ?? '',
      moduleName: config.moduleName ?? '',
      token: config.token ?? '',
      compression: config.compression ?? '',
      lightMode: config.lightMode ?? false,
      confirmedReads: config.confirmedReads ?? '',
    };
    return JSON.stringify(keyObject);
  }

  patchBuilderPrototype();

  interface Props<
    DbConnection extends DbConnectionImpl,
    ErrorContext,
    SubscriptionEventContext,
  > {
    connectionBuilder: DbConnectionBuilder<
      DbConnection,
      ErrorContext,
      SubscriptionEventContext
    >;
    cacheKey?: string;
    children: Snippet;
  }

  let {
    connectionBuilder,
    cacheKey,
    children
  }: Props<any, any, any> = $props();

  const builder = connectionBuilder as AnyBuilder;
  const key = getConnectionCacheKey(builder, cacheKey);

  let cacheEntry = connectionCache.get(key);
  if (cacheEntry?.disconnectTimer) {
    clearTimeout(cacheEntry.disconnectTimer);
    cacheEntry.disconnectTimer = undefined;
  }

  if (!cacheEntry) {
    const connection = builder.build();
    const context = new SpacetimeDBContext(connection);
    cacheEntry = {
      connection,
      context,
      refCount: 0,
    };
    connectionCache.set(key, cacheEntry);
  }

  cacheEntry.refCount += 1;

  setSpacetimeContext(cacheEntry.context);

  onDestroy(() => {
    const entry = connectionCache.get(key);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.disconnectTimer = setTimeout(() => {
        entry.context.connection.disconnect();
        connectionCache.delete(key);
      }, 0);
    }
  });
</script>

{@render children()}
