import { getContext, setContext } from "svelte";
import * as moduleBindings from './module_bindings/index';
import type { Identity } from "spacetimedb";
import type { GamePlayerExtended } from "./module_bindings_extended/GamePlayerExtended.svelte";

const key = Symbol('PushedPeopleSpacetimeContext');

export type PushedPeopleSpacetimeContext = {
    identity: Identity | undefined;
    serverConfig: moduleBindings.Config | undefined;
    connectedGame: moduleBindings.Game | undefined;
    miniGames: moduleBindings.MiniGame[];
    gameEntities: moduleBindings.Entity[];
    gamePlayers: GamePlayerExtended[];
    clientPlayer: moduleBindings.Player | undefined;
    clientGamePlayer: GamePlayerExtended | undefined;
}

export function setPushedPeopleSpacetimeContext(gameContext: PushedPeopleSpacetimeContext) {
  setContext(key, gameContext);
}

export function getPushedPeopleSpacetimeContext(): PushedPeopleSpacetimeContext {
    return getContext(key);
}

class SpacetimePlayer {
    name: string | undefined;
    identity: Identity;
    id: number;
    gameId: number | undefined = $state();
    gamePlayer: GamePlayerExtended | undefined = $state();

    constructor(name: string | undefined, identity: Identity, id: number, gameId: number | undefined) {
        this.name = name;
        this.identity = identity;
        this.id = id;
        this.gameId = gameId;
    };
}