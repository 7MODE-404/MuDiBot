use crate::localization::Localize;

use std::borrow::Cow;

use serenity::framework::standard::{Args, CommandResult, Delimiter};

cfg_if::cfg_if! {
    if #[cfg(test)] {
        use crate::test_doubles::serenity::{
            client::Context,
            model::{channel::Message, id::UserId},
        };
    } else {
        use serenity::{
            client::Context,
            model::{channel::Message, id::UserId},
        };
    }
}

fn avatar(ctx: &mut Context, msg: &Message) -> CommandResult {
    let mut args = Args::new(msg.content.as_str(), &[Delimiter::Single(' ')]);
    // Skip cmd
    args.advance();

    let msg_to_send = match args.parse::<UserId>() {
        Ok(user_id) => match user_id.to_user(&ctx.http) {
            Ok(user) => match user.avatar {
                Some(avatar_id) => Cow::Owned(format!(
                    "https://cdn.discordapp.com/avatars/{}/{}.png?size=2048",
                    user_id, avatar_id
                )),
                None => ctx.localize_msg("no-custom-avatar", None)?,
            },
            Err(_) => ctx.localize_msg("wrong-user-id", None)?,
        },
        Err(_) => ctx.localize_msg("missing-user", None)?,
    };

    msg.channel_id.say(&ctx.http, msg_to_send)?;

    Ok(())
}

#[cfg(not(test))]
pub mod commands {
    use serenity::{
        framework::standard::{macros::command, CommandResult},
        model::prelude::*,
        prelude::*,
    };

    #[command]
    #[min_args(1)]
    #[description("Get the avatar of an user")]
    #[usage("<user>")]
    fn avatar(ctx: &mut Context, msg: &Message) -> CommandResult {
        super::avatar(ctx, msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::localization::L10NBundle;

    use crate::test_doubles::serenity::{
        http::client::Http,
        model::{id::MockUserId, user::User},
    };
    use crate::test_doubles::CONTEXT_SYNCHRONIZER;
    use crate::test_utils;

    use serenity::{model::misc::UserIdParseError, prelude::RwLock};

    fn test_avatar(
        msg: &str,
        response_msg: &str,
        mut http: Http,
        user_id: Result<UserId, UserIdParseError>,
    ) -> CommandResult {
        test_utils::check_response_msg(&mut http, response_msg);

        // Mock context
        let mut ctx = Context::_new(None, http);
        {
            let mut data = ctx.data.write();
            data.insert::<L10NBundle>(RwLock::new(L10NBundle::new("en-US")?));
        }

        // Mock message
        let msg = Message::_from_str(msg);

        // Guards for mock contexts
        let _guards = CONTEXT_SYNCHRONIZER.get_ctx_guards(vec!["user_id_from_str"]);

        let mock_user_id_ctx = MockUserId::from_str_context();
        mock_user_id_ctx.expect().once().return_once(|_| user_id);

        avatar(&mut ctx, &msg)?;

        Ok(())
    }

    #[test]
    fn avatar_missing_user() -> CommandResult {
        test_avatar(
            "$avatar bad_user",
            "Missing argument: user.",
            Http::new(),
            Err(UserIdParseError::InvalidFormat),
        )
    }

    #[test]
    fn avatar_wrong_user() -> CommandResult {
        // Main mock
        let mut http = Http::new();
        http.expect_mock_get_user()
            .returning(|| Err(serenity::Error::Other("Wrong user")));

        test_avatar(
            "$avatar bad_user_but_better",
            "Wrong user id.",
            http,
            Ok(UserId(2)),
        )
    }

    #[test]
    fn avatar_no_custom_avatar() -> CommandResult {
        // Main mock
        let mut http = Http::new();
        http.expect_mock_get_user()
            .returning(|| Ok(User { avatar: None }));

        test_avatar(
            "$avatar good_user_but_default_avatar",
            "This user doesn't have a custom avatar.",
            http,
            Ok(UserId(2)),
        )
    }

    #[test]
    fn avatar_custom_avatar() -> CommandResult {
        // Main mock
        let mut http = Http::new();
        http.expect_mock_get_user().returning(|| {
            Ok(User {
                avatar: Some("some_id".to_string()),
            })
        });

        test_avatar(
            "$avatar good_user_but_default_avatar",
            "https://cdn.discordapp.com/avatars/2/some_id.png?size=2048",
            http,
            Ok(UserId(2)),
        )
    }
}