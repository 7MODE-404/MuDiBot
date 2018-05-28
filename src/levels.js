const bot = require('./bot.js');
const mustache = require('mustache');
const sql = require('sqlite');
const permGroups = require('./modules/user/permission-group.js');
const userDB = require('./modules/user/user-db.js');
const config = require('./args.js').getConfig()[1];
const lastMessages = [];
var lang = require('./localization.js').getLocalization();
var maxValue = 1000;

//Ranks are in order, the lowest first
var ranks = [{
    //Vagabond
    name: lang.ranks.vagabond,
    color: 0x808080
  },
  {
    //Farmer
    name: lang.ranks.farmer,
    color: 0xffff3c
  },
  {
    //Warrior
    name: lang.ranks.warrior,
    color: 0xff3333
  },
  {
    //Lord
    name: lang.ranks.lord,
    color: 0x3c3cff
  },
  {
    //King
    name: lang.ranks.king,
    color: 0xffaa00
  },
  {
    //Emperor
    name: lang.ranks.emperor,
    color: 0x8c1aff
  },
  {
    //XP Master
    name: lang.ranks.xpMaster,
    color: 0x00ff40
  },
  {
    //Spam Master
    name: lang.ranks.spamMaster,
    color: 0xff3c9d
  },
  {
    //XP God
    name: lang.ranks.xpGod,
    color: 0x00ff00
  },
  {
    //Spam God
    name: lang.ranks.spamGod,
    color: 0xff0080
  },
];

var lastRank = {
  name: lang.ranks.lastRank,
  color: 0xff0000
}

async function modifyUserXp(msg, userId, value) {
  try {
    await sql.open(config.pathDatabase);
    await sql.run('CREATE TABLE IF NOT EXISTS users (serverId TEXT, userId TEXT, xp INTEGER, warnings INTEGER, groups TEXT)');
    //Add xp to user
    await sql.run('UPDATE users SET xp = ? WHERE serverId = ? AND userId = ?', [value, msg.guild.id, userId]);
    await sql.close();
  } catch (e) {
    console.error(e);
  }
}

function getRewardInMsg(msg, args) {
  var role = msg.mentions.roles.first();
  if (args[1] == undefined) {
    bot.printMsg(msg, lang.error.missingArg.reward);
    return;
  }
  var group = args[1].charAt(0).toUpperCase() + args[1].slice(1);

  //Check if reward is a role
  if (role != null) {
    if (msg.guild.roles.has(role.id)) {
      //Reward is a role
      return role.id;
    }
  } else if (group == null) { //Check if reward is a group
    //No reward
    bot.printMsg(msg, lang.error.missingArg.reward);
    return;
  } else if (config.groups.find(x => x.name == group) != undefined) {
    //Reward is group;
    return group;
  }
  bot.printMsg(msg, lang.error.invalidArg.reward);
  return;
}

async function addReward(msg, reward) {
  if (config.groups.find(x => x.name == reward) != undefined) {
    //Reward is a group
    await permGroups.setGroup(msg, msg.author, reward)
    return reward;
  } else {
    //Add role
    msg.member.addRole(reward, lang.general.member.addReward).catch(error => {
      console.log(error);
    });
    return msg.guild.roles.get(reward).name;
  }
}

async function getReward(msg, rank) {
  try {
    await sql.open(config.pathDatabase);
  } catch (e) {
    console.error(e);
  }
  try {
    var user = await sql.get("SELECT reward FROM rewards WHERE serverId = ? AND rank = ?", [msg.guild.id, rank[0]]);
  } catch (e) {
    try {
      await sql.run("CREATE TABLE IF NOT EXISTS rewards (serverId TEXT, rank TEXT, reward TEXT)");
    } catch (e) {
      console.error(e);
    }
  }
  await sql.close();
  if(user != undefined) {
    return user.reward;
  }
}

module.exports = {
  getXpForLevel: function(level) {
    return level ** 1.5 - (level ** 1.5) % 5 + 100
  },
  getProgression: function(remainingXp) {
    var totalLevel = 1;
    var realLevel = totalLevel;

    while (remainingXp >= this.getXpForLevel(realLevel)) {
      remainingXp -= this.getXpForLevel(realLevel);
      totalLevel++;
      realLevel = totalLevel - Math.floor(totalLevel / 100) * 100
      //Check if level is egal to max value
      if (totalLevel == maxValue) {
        return [realLevel, 0, maxValue];
      }
    }
    return [realLevel, remainingXp, totalLevel];
  },
  getRank: function(level) {
    var prestige = Math.floor(level / 100);
    //Remove prestige from the total level
    level -= prestige * 100

    //Check if level is under max value
    var rank = (level < maxValue) ? ranks[Math.floor(level / 10)] : lastRank;
    //Check if rank exists
    if (rank == undefined) {
      console.log(lang.error.notFound.rank);
      return [undefined, prestige];
    }
    //Check if name is localized
    if (rank.name == undefined) {
      console.log(lang.error.notLocalized.rank);
      return [undefined, prestige];
    }

    //Return rank and prestige
    return [rank.name, prestige, rank.color]
  },
  newMessage: async function(msg) {
    var userLastMessage = lastMessages.find(x => x.author == msg.author.id);
    var currentTime = Date.now();

    if (userLastMessage == undefined) {
      userLastMessage = {
        time: 0
      };
      //Add user
      lastMessages.push({
        author: msg.author.id,
        time: currentTime
      })
    }

    //Check if user is spamming
    if (currentTime - userLastMessage.time < config.levels.cooldown) {
      return;
    }

    if (lastMessages.indexOf(userLastMessage) > -1) {
      //Remove old message
      lastMessages.splice(lastMessages.indexOf(userLastMessage), 1)
      //Reset time last message
      lastMessages.push({
        author: msg.author.id,
        time: currentTime
      })
    }

    var xp = await userDB.user.getXp(msg.guild.id, msg.author.id);
    if (xp != undefined) {
      //Add 1 per 2 characters
      var extraXp = Math.trunc(msg.content.replace(/\s/g, "").length / 3);
      //Get a random number from 1 to 3 and add extra xp (max is 20);
      xpGained = Math.min(20, (Math.floor(Math.random() * 3) + 1) + extraXp);
      await modifyUserXp(msg, msg.author.id, xp + xpGained);

      let progression = this.getProgression(xp);
      let xpForNextLevel = this.getXpForLevel(progression[0]) - progression[1];
      //Check if user has level up
      if (xpGained >= xpForNextLevel) {
        //Level up!
        var message = mustache.render(lang.general.member.leveled, {
          msg,
          progression: progression[0] + 1
        });
        //Check if users has ranked up
        if ((progression[0] + 1) % 10 == 0) {
          rank = this.getRank(progression[2] + 1)
          message += '\n' + mustache.render(lang.general.member.rankUp, {
            rank: `${rank[0]}${(rank[1] > 0) ? ` (${rank[1]}:star:)` : ''}`
          });
          var reward = await getReward(msg, rank);
          if (reward != undefined) {
            //Reward found for this rank
            let name = await addReward(msg, reward);
            message += ' ' + mustache.render(lang.general.member.reward, {
              role: name
            });
            //Check if the removal of the old role is enabled
            if (config.levels.removeOldRole == true) {
              var oldRole = await getReward(msg, this.getRank(progression[2]));
              if (oldRole != undefined) {
                msg.member.removeRole(oldRole, lang.general.member.removeOldReward).catch(error => {
                  console.log(error);
                });
              }
            }
          } else {
            //TODO: maybe remove
            bot.printMsg(msg, lang.error.notFound.rankReward);
          }
          //Add exclamation mark at the end
          message += '!';
        }
        bot.printMsg(msg, message);
      }
    }
  },
  setReward: async function(msg, args) {
    var rank = args[0];
    //Check if there is a rank in msg
    if (rank == undefined) {
      //Missing argument: rank
      bot.printMsg(msg, lang.error.missingArg.rank);
      return;
    }
    var reward = getRewardInMsg(msg, args);
    //Check if there is a reward in msg
    if (reward == undefined) {
      return;
    }
    //Put first character of rank in uppercase
    rank = rank.charAt(0).toUpperCase() + rank.slice(1);

    //Check if rank exists
    if (ranks.find(x => x.name == rank) != undefined) {
      try {
        await sql.open(config.pathDatabase);
      } catch (e) {
        console.error(e);
      }
      try {
        var row = await sql.get('SELECT * FROM rewards WHERE serverId = ? AND rank = ?', [msg.guild.id, rank]);
      } catch (e) {
        try {
          await sql.run("CREATE TABLE IF NOT EXISTS rewards (serverId TEXT, rank TEXT, reward TEXT)");
          await sql.run("INSERT INTO rewards (serverId, rank, reward) VALUES (?, ?, ?)", [msg.guild.id, rank, reward]);
        } catch (e) {
          console.error(e);
        }
      }
      //Got row
      if (!row) {
        //Table exist but not row
        await sql.run("INSERT INTO rewards (serverId, rank, reward) VALUES (?, ?, ?)", [msg.guild.id, rank, reward]);
      } else {
        await sql.run("UPDATE rewards SET rank = ?, reward = ? WHERE serverId = ?", [rank, reward, msg.guild.id]);
      }
      msg.channel.send(lang.setreward.newReward);
      await sql.close();
      return row;
    } else {
      //Rank don't exists
      bot.printMsg(msg, lang.error.notFound.rank);
    }
  },
  unsetReward: async function(msg, args) {
    var rank = args[0];
    //Check if there is a rank in msg
    if (rank == undefined) {
      //Missing argument: rank
      bot.printMsg(msg, lang.error.missingArg.rank);
      return;
    }
    //Put first character of rank in uppercase
    rank = rank.charAt(0).toUpperCase() + rank.slice(1);

    try {
      await sql.open(config.pathDatabase);
    } catch (e) {
      console.error(e);
    }
    try {
      var row = await sql.all("SELECT * FROM rewards WHERE serverId = ? AND rank = ?", [msg.guild.id, rank]);
    } catch (e) {
      try {
        await sql.run("CREATE TABLE IF NOT EXISTS rewards (serverId TEXT, rank TEXT, reward TEXT)");
      } catch (e) {
        console.error(e);
      }
    }
    if (row.length > 0) {
      try {
        await sql.all("DELETE FROM rewards WHERE serverId = ? AND rank = ?", [msg.guild.id, rank]);
      } catch (e) {
        console.error(e);
      }
      bot.printMsg(msg, lang.unsetreward.rewardUnset);
    } else {
      if (ranks.find(x => x.name == rank) != undefined) {
        //Reward not found
        bot.printMsg(msg, lang.error.notFound.rankReward);
      } else {
        //Rank not found
        bot.printMsg(msg, lang.error.notFound.rank);
      }
    }
    await sql.close();
  }
}
