// stolen from spacetimedb quickstart chat example and expanded to allow multiple group chats

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

#[spacetimedb::table(name = user, public)]
pub struct User {
    #[primary_key]
    identity: Identity,
    name: Option<String>,
}


#[spacetimedb::table(name = groupchat_membership,
    index(name = user_and_groupchat, btree(columns = [identity, groupchat_id])),
    public)]
pub struct GroupChatMembership {
    #[primary_key]
    #[auto_inc]
    id: u32,
    #[index(btree)]
    identity: Identity,
    #[index(btree)]
    groupchat_id: u32
}

#[spacetimedb::table(name = message, public)]
pub struct Message {
    sender: Identity,
    sent: Timestamp,
    text: String,
    #[index(btree)]
    groupchat_id: u32
}

#[spacetimedb::table(name = groupchat, public)]
pub struct GroupChat {
    #[primary_key]
    #[auto_inc]
    id: u32,
    name: String,
    created_by: Identity,
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
    ctx.db.groupchat().insert(GroupChat { 
        id: 0, // Auto-incremented
        name,
        created_by: ctx.sender
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_group_chat_name(ctx: &ReducerContext, groupchat_id: u32, new_name: String) -> Result<(), String> {
    if new_name.is_empty() {
        return Err("Group chat name must not be empty".to_string());
    }
    
    // Find the existing group chat
    if let Some(groupchat) = ctx.db.groupchat().id().find(&groupchat_id) {
        // Check if the caller is the creator
        if groupchat.created_by != ctx.sender {
            return Err("Only the creator can rename the group chat".to_string());
        }
        
        log::info!("Renaming group chat {} to '{}' by {}", groupchat_id, new_name, ctx.sender);
        
        // Update the group chat name (ID stays the same)
        ctx.db.groupchat().id().update(GroupChat {
            id: groupchat_id,
            name: new_name,
            created_by: groupchat.created_by,
        });
        
        Ok(())
    } else {
        Err("Group chat does not exist".to_string())
    }
}

#[spacetimedb::reducer]
pub fn join_groupchat(ctx: &ReducerContext, groupchat_id: u32) -> Result<(), String> {
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        if ctx.db.groupchat().id().find(&groupchat_id).is_some() {
            // if membership to this groupchat already exists for this user, error out
            if ctx.db.groupchat_membership().user_and_groupchat().filter((user.identity, groupchat_id)).next().is_none() {
                ctx.db.groupchat_membership().insert(GroupChatMembership {
                    id: 0,
                    identity: ctx.sender,
                    groupchat_id
                });
            } else {
                return Err("User is already a member of this group chat".to_string());
            }
            Ok(())
        } else {
            Err("Group chat does not exist".to_string())
        }
    } else {
        Err("Cannot join group chat for unknown user".to_string())
    }
}

#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, groupchat_id: u32, text: String) -> Result<(), String> {
    let text = validate_message(text)?;
    // check if groupchat exists and if membership exists for this user in this groupchat
    if ctx.db.groupchat().id().find(&groupchat_id).is_none() {
        return Err("Group chat does not exist".to_string());
    }
    if ctx.db.groupchat_membership().user_and_groupchat().filter((ctx.sender, groupchat_id)).next().is_none() {
        return Err("User is not a member of this group chat".to_string());
    }
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
    if ctx.db.user().identity().find(ctx.sender).is_none() {
        // If this is a new user, create a `User` row for the `Identity`,
        // which is online, but hasn't set a name.
        ctx.db.user().insert(User {
            name: None,
            identity: ctx.sender,
        });
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    // remove the user and all their group chat memberships when they disconnect
    for membership in ctx.db.groupchat_membership().identity().filter(ctx.sender) {
        ctx.db.groupchat_membership().id().delete(membership.id);
    }
    if let Some(user) = ctx.db.user().identity().find(ctx.sender) {
        ctx.db.user().identity().delete(user.identity);
    }
}