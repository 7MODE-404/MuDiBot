mod commands;
mod config;
mod localization;
#[cfg(test)]
mod test_doubles;
mod util;

use localization::Localize;

use std::sync::Arc;

use fluent::fluent_args;
use serenity::prelude::{Mutex, TypeMapKey};

#[macro_use]
extern crate log;

cfg_if::cfg_if! {
    if #[cfg(test)] {
        use test_doubles::serenity::{
            client::{bridge::gateway::ShardManager, Context, EventHandler},
            model::{gateway::Ready, event::ResumedEvent},
        };
    } else {
        use std::{collections::HashSet, env};

        use env_logger::{Env, Builder, Target};
        use serenity::{
            client::{bridge::gateway::ShardManager, Client, Context, EventHandler},
            framework::{standard::macros::group, StandardFramework},
            model::{gateway::Ready, event::ResumedEvent},
        };

        use commands::meta::commands::*;

        #[group]
        #[commands(ping, info)]
        struct General;
    }
}
struct ShardManagerContainer;

impl TypeMapKey for ShardManagerContainer {
    type Value = Arc<Mutex<ShardManager>>;
}

struct Handler;

impl EventHandler for Handler {
    fn ready(&self, ctx: Context, ready: Ready) {
        let args = fluent_args!["bot-user" => ready.user.name];
        info!("{}⁨", ctx.localize_msg("connected", Some(&args)).unwrap());
    }

    fn resume(&self, ctx: Context, _: ResumedEvent) {
        info!("{}", ctx.localize_msg("resumed", None).unwrap());
    }
}

#[cfg(not(test))]
fn main() {
    let env = Env::default()
        .filter_or("RUST_LOG", "info")
        .write_style_or("RUST_LOG_STYLE", "always");

    Builder::from_env(env).target(Target::Stdout).init();

    let config = config::Config::new();

    // Init localization
    let bundle = localization::L10NBundle::new(config.get_locale());
    info!("{}", bundle.localize_msg("startup", None).unwrap());

    let project_dir = util::get_project_dir().unwrap();
    let args = fluent_args!["config-dir" => project_dir.config_dir().to_string_lossy()];
    info!(
        "{}",
        bundle.localize_msg("config-loaded", Some(&args)).unwrap()
    );

    let env_var_token = env::var("DISCORD_TOKEN");
    let token = env_var_token
        .as_ref()
        .map(|x| x.as_str())
        .unwrap_or_else(|_| {
            config
                .get_creds()
                .bot_token
                .as_ref()
                .unwrap_or_else(|| {
                    panic!(bundle.localize_msg("no-token", None).unwrap().into_owned())
                })
                .as_str()
        });

    let prefix = config.get_prefix().to_string();

    let mut client = Client::new(token, Handler).unwrap_or_else(|_| {
        panic!(bundle
            .localize_msg("client-creation-error", None)
            .unwrap()
            .into_owned())
    });

    {
        let mut data = client.data.write();
        data.insert::<ShardManagerContainer>(Arc::clone(&client.shard_manager));
        data.insert::<config::Config>(config);
        data.insert::<localization::L10NBundle>(Mutex::new(bundle));
    }

    let owners = match client.cache_and_http.http.get_current_application_info() {
        Ok(info) => {
            let mut set = HashSet::new();
            set.insert(info.owner.id);

            set
        }
        Err(why) => panic!(client
            .localize_msg(
                "application-info-error",
                Some(&fluent_args!["error" => why.to_string()])
            )
            .unwrap()
            .into_owned()),
    };

    client.with_framework(
        StandardFramework::new()
            .configure(|c| c.owners(owners).prefix(prefix.as_str()))
            .before(|_ctx, msg, _cmd_name| {
                let base_msg = format!("{}<{}> -> {}", msg.author.name, msg.author.id, msg.content);

                if let Some(guild_id) = msg.guild_id {
                    info!("[{}-{}] {}", guild_id, msg.channel_id, base_msg);
                } else {
                    info!("[{}] {}", msg.channel_id, base_msg);
                }
                true
            })
            .group(&GENERAL_GROUP)
            .help(&HELP),
    );

    if let Err(why) = client.start() {
        warn!(
            "{}",
            client
                .localize_msg(
                    "client-error",
                    Some(&fluent_args!["error" => why.to_string()])
                )
                .unwrap()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use localization::L10NBundle;
    use test_doubles::serenity::model::user::CurrentUser;

    #[test]
    fn ready_event() {
        let ctx = Context::_new(None);
        {
            let mut data = ctx.data.write();
            data.insert::<L10NBundle>(serenity::prelude::Mutex::new(L10NBundle::new("en-US")));
        }
        Handler.ready(
            ctx,
            Ready {
                user: CurrentUser {
                    id: 0,
                    name: "TestBot".to_string(),
                },
            },
        );
    }

    #[test]
    fn resume_event() {
        let ctx = Context::_new(None);
        {
            let mut data = ctx.data.write();
            data.insert::<L10NBundle>(serenity::prelude::Mutex::new(L10NBundle::new("en-US")));
        }
        Handler.resume(ctx, ResumedEvent {});
    }
}
