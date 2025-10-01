import type { User } from "./components/spacetime/module_bindings";

export class AppContext {
        clientUser = $state<User | null>(null);
}