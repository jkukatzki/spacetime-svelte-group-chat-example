import type { User } from "./components/spacetime/module_bindings";
import type { ReactiveTable } from "./components/spacetime/svelte_context/getReactiveTable.svelte";

export class AppContext {
        clientUser = $state<User | null>(null);
        users: ReactiveTable<User>;
        constructor(users: ReactiveTable<User>) {
                this.users = users;
        }
}