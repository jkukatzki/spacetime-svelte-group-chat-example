// stolen from spacetimedb quickstart chat example and expanded to allow multiple group chats

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

#[spacetimedb::table(name = user, public)]
pub struct User {
    #[primary_key]
    identity: Identity,
    name: Option<String>,
    online: bool,
    #[index(btree)]
    groupchat_id: Option<String>
}

#[spacetimedb::table(name = message, public)]
pub struct Message {
    sender: Identity,
    sent: Timestamp,
    text: String,
    #[index(btree)]
    groupchat_id: String
}

#[spacetimedb::table(name = groupchat, public)]
pub struct GroupChat {
    #[primary_key]
    id: String
}


fn validate_name(name: String) -> Result<String, String> {
    if name.is_empty() {
        Err("Names must not be empty".to_string())
    } else {
        Ok(name)
    }
}

#[spacetimedb::reducer]
pub fn set_name(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let name = validate_name(name)?;
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        log::info!("User {} sets name to {name}", ctx.sender);
        ctx.db.user().identity().update(User {
            name: Some(name),
            ..user
        });
        Ok(())
    } else {
        Err("Cannot set name for unknown user".to_string())
    }
}

fn validate_message(text: String) -> Result<String, String> {
    if text.is_empty() {
        Err("Messages must not be empty".to_string())
    } else {
        Ok(text)
    }
}

#[spacetimedb::reducer]
pub fn create_groupchat(ctx: &ReducerContext, name: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("Group chat name must not be empty".to_string());
    }
    ctx.db.groupchat().try_insert(GroupChat { id: name })
        .map(|_| ())
        .map_err(|e| format!("Failed to create group chat: {}", e))
}

#[spacetimedb::reducer]
pub fn join_groupchat(ctx: &ReducerContext, groupchat: String) -> Result<(), String> {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        if ctx.db.groupchat().id().find(&groupchat).is_some() {
            ctx.db.user().identity().update(User {
                groupchat_id: Some(groupchat),
                ..user
            });
            Ok(())
        } else {
            Err("Group chat does not exist".to_string())
        }
    } else {
        Err("Cannot join group chat for unknown user".to_string())
    }
}

#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, text: String) -> Result<(), String> {
    let text = validate_message(text)?;
    let groupchat_id = if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        if let Some(gc_id) = &user.groupchat_id {
            gc_id.clone()
        } else {
            return Err("User is not in a group chat".to_string());
        }
    } else {
        return Err("Cannot send message for unknown user".to_string());
    };
    ctx.db.message().insert(Message {
        sender: ctx.sender,
        text,
        sent: ctx.timestamp,
        groupchat_id
    });
    Ok(())
}

#[spacetimedb::reducer(init)]
// Called when the module is initially published
pub fn init(_ctx: &ReducerContext) {}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        // If this is a returning user, i.e. we already have a `User` with this `Identity`,
        // set `online: true`, but leave `name` and `identity` unchanged.
        ctx.db.user().identity().update(User { online: true, ..user });
    } else {
        // If this is a new user, create a `User` row for the `Identity`,
        // which is online, but hasn't set a name.
        ctx.db.user().insert(User {
            name: None,
            identity: ctx.sender,
            online: true,
            groupchat_id: None
        });
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        ctx.db.user().identity().update(User { online: false, groupchat_id: None, ..user });
    } else {
        // This branch should be unreachable,
        // as it doesn't make sense for a client to disconnect without connecting first.
        log::warn!("Disconnect event for unknown user with identity {:?}", ctx.sender);
    }
}