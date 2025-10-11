<script lang="ts">
	import { Badge, Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, Modal, Row } from "@sveltestrap/sveltestrap";
	import { STQuery, eq, where } from "./spacetime/svelte_context";
	import { DbConnection, GroupChat, GroupChatMembership, Message } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { getContext } from "svelte";
	import type { AppContext } from "$lib/AppContext.svelte";

    const appContext: AppContext = getContext('AppContext');
    const spacetimeContext = getSpacetimeContext<DbConnection>();

    let selectedGroupChat: GroupChat | undefined = $state();
    
    let groupChats = new STQuery<DbConnection, GroupChat>('groupchat');
    let messages = $derived(new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat?.id))));
    let groupChatMemberships = $derived(new STQuery<DbConnection, GroupChatMembership>('groupchat_membership', where(eq('groupchatId', selectedGroupChat?.id))));
    let clientMemberships = $derived(new STQuery<DbConnection, GroupChatMembership>('groupchat_membership', where(eq('identity', spacetimeContext.identity))));

    let createGroupChatModalOpen = $state(false);
    let createGroupChatName = $state("");
    let input = $state("");

    const sendMessage = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (input.trim() === "") {
            return;
        }
        if (!selectedGroupChat) {
            console.error("No groupchat selected");
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(selectedGroupChat.id, input);
        input = ""; // Clear input after sending
    }

</script>

{#if spacetimeContext.connection}
    <Container xl class="vh-100 d-flex flex-column" style="overflow: hidden;">
        <!-- Connection Status Bar -->
        <div class="connection-status {spacetimeContext.connected ? 'ready' : 'connecting'}">
            {#if spacetimeContext.connected}
                🟢 Connected to SpacetimeDB
            {:else}
                🟡 Connecting to SpacetimeDB...
            {/if}
        </div>
        
        <Row class="mt-4 gx-3" style="height: calc(100vh - 120px); overflow: hidden;">
            <Col xs="2">
                <Container fluid class="border rounded p-2">
                    <!-- GROUP CHAT SELECTION -->
                    {#if groupChats.rows !== undefined}
                        <Button class="mb-3" color="primary" onclick={() => createGroupChatModalOpen = true} disabled={!spacetimeContext.connected}>
                            Create group chat +
                        </Button>
                        <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                            <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                            <Button onclick={() => {
                                if (createGroupChatName.trim() !== "") {
                                    spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                                    createGroupChatName = "";
                                    createGroupChatModalOpen = false;
                                }
                            }}>Create</Button>
                        </Modal>
                        <h4>My Groups:</h4>
                        {#each groupChats.rows.filter(chat => clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                            <div class="my-2">
                                <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                    {chat.id}
                                </Button>
                            </div>
                        {:else}
                            <p class="text-muted ms-1 mb-3">Not a member of any groups.</p>
                        {/each}
                        <h4>Available Groups:</h4>
                        {#each groupChats.rows.filter(chat => !clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                            <div class="my-2">
                                <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                    {chat.id}
                                </Button>
                            </div>
                        {/each}
                    {:else}
                        <h3>{spacetimeContext.connected ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                    {/if}
                </Container>
            </Col>
            <!-- GROUP CHAT -->
            <Col xs="7" class="border rounded p-3 d-flex flex-column h-100">
                <!-- HEADER -->
                {#if selectedGroupChat}
                    <div class="flex-shrink-0">
                        <h4>Group Chat {selectedGroupChat.id}</h4>
                        {#if clientMemberships?.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                            {#if messages.rows !== undefined}
                                <div class="chat-header mb-3">
                                    <small>Total: {messages.rows.length ?? '/'} messages</small>
                                </div>
                            {/if}
                        {/if}
                    </div>
                    {#if clientMemberships?.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                        {#if messages.rows !== undefined}
                            <!-- MESSAGES AND MESSAGE INPUT -->
                            <div class="d-flex flex-column flex-grow-1" style="min-height: 0;">
                                <div class="flex-grow-1 overflow-auto mb-3">
                                    {#each messages.rows as message}
                                        <Card class="mb-2">
                                            <CardHeader>{message.sender.toHexString().slice(-6)} <small class="float-left fs-7 text-muted">at {new Date(message.sent.toDate()).toLocaleTimeString()}</small></CardHeader>
                                            <CardBody>{message.text}</CardBody>
                                        </Card>
                                    {/each}
                                </div>
                                <div class="flex-shrink-0">
                                    <InputGroup>
                                        <Input placeholder="Type a message..." bind:value={input} onkeydown={(e) => e.key === 'Enter' && sendMessage()} disabled={!spacetimeContext.connected} />
                                        <Button onclick={sendMessage} disabled={!spacetimeContext.connected}>Send</Button>
                                    </InputGroup>
                                </div>
                            </div>
                        {:else}
                            <Card>
                                <CardBody>Loading messages...</CardBody>
                            </Card>
                        {/if}
                    {:else}
                        <h5>You are not a member of this group chat.</h5>
                        <Button color="primary" class="mb-2" onclick={() => {
                            if (spacetimeContext.connection && selectedGroupChat) {
                                spacetimeContext.connection.reducers.joinGroupchat(selectedGroupChat.id);
                            }
                        }}>Join Chat</Button>
                    {/if}
                {:else}
                    <h3>Select a group chat!</h3>
                {/if}
            </Col>
            <!-- USERS -->
            <Col xs="3">
                {#if appContext.clientUser}
                    <Card class="border-primary">
                        <CardHeader><h6>{appContext.clientUser.name ? appContext.clientUser.name : appContext.clientUser.identity.toHexString()}</h6></CardHeader>
                    </Card>
                {/if}
                <h6 class="mt-3">All Users:</h6>
                {#if appContext.users}
                    <div class="ms-2">
                        {#each appContext.users.rows ?? [] as user}
                            <Badge 
                                pill={true}
                                color={['primary', 'danger', 'success', 'warning'][Math.floor(Math.random() * 4)]}
                                class="me-1"
                            >
                                {user.name ? user.name[0] : user.identity.toHexString().slice(-6)}
                            </Badge>
                        {/each}
                    </div>
                {/if}
            </Col>
        </Row>
    </Container>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}