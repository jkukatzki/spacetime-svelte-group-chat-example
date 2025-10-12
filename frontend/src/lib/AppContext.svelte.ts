import type { User, DbConnection } from "./components/spacetime/module_bindings";
import type { STQuery } from "./components/spacetime/svelte_spacetime/STQuery.svelte";

export class AppContext {
        clientUser = $state<User | null>(null);
        users: STQuery<DbConnection, User>;
        constructor(users: STQuery<DbConnection, User>) {
                this.users = users;
        }
}