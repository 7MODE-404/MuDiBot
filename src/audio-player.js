//Play requested audio when called
const ytdl = require('ytdl-core');
const https = require('https');
const bot = require('./bot.js');
const config = require('../config.js');
var queue = [];
var voiceConnection;

function joinChannel(message) {
	var channel = message.member.voiceChannel;
	if (typeof channel !== "undefined") {
		channel.join().then(connection => playVideo(connection, message));
	}
}

function get(url) {
	return new Promise(function(resolve) {
		https.get(url, (res) => {
			var body = '';
			res.on("data", function (chunk) {
				body += chunk;
			});
			res.on('end', function () {
				resolve(JSON.parse(body));
			});
		}).on('error', function (e) {
			console.log("Error: " + e.message);
		});
	});
}
function addToQueue(message, url) {
	if(url.indexOf('list=') !== -1) {
		//Url is a playlist
		var regExpPlaylist = new RegExp("list=([a-zA-Z0-9\-\_]+)&?","i");
		var id = regExpPlaylist.exec(url);
		var api = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=' + id[1] + '&maxResults=50&key=' + config.youtubeAPIKey;

		get(api).then(function(response) {
			getPlaylistVideos(0, response, message);
		});
	} else {
		//Url is a video
		checkIfAvailable(url).then(values => {
			let text = (values != null) ? '"' + values[1] + '" added to the queue' : 'This video is unavailable'
			if(values != null) {
				queue.push(values);
			}
			bot.printMsg(message, text);
			if (message.member.voiceChannel.connection == null && queue.length != 0) {
				joinChannel(message);
			}
		});
	}
}
function getPlaylistVideos(i, response, message) {
	var promises = [];
	for(i = 0; i < response.items.length; i++) {
		var video = 'https://www.youtube.com/watch?v=' + response.items[i].snippet.resourceId.videoId
		promises[i] = checkIfAvailable(video).then(values => {
			return values;
		});
	}
	Promise.all(promises).then(values => {
		for(n = 0; n < values.length; n++) {
			if(values[n] != null) {
				queue.push(values[n]);
			}
		}
		bot.printMsg(message, 'Playlist added to the queue');
		if (message.member.voiceChannel.connection == null && queue.length != 0) {
			joinChannel(message);
		}
	});
}

function checkIfAvailable(url) {
	return new Promise((resolve) => {
		var regex = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
		var id = url.match(regex);
		var api = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + id + '&key=' + config.youtubeAPIKey;
		get(api).then(function(response) {
			if (false) {
				resolve(false);
			} else {
				ytdl.getInfo(url).then(info => {
					var duration = response.items[0].contentDetails.duration.match(/\d\d*\w/g).join(' ');
					resolve([url, info.title, duration.toLowerCase()]);
				}, function() {
					resolve(null);
				});
			}
		});
	});
}

//Play YouTube video (audio only)
function playVideo(connection, message) {
	voiceConnection = true;
	bot.printMsg(message, 'Playing: "' + queue[0][1] + '" (' + queue[0][2] + ')');
	//Downloading
	var stream = ytdl(queue[0][0], {
		filter: 'audioonly'
	});
	dispatcher = connection.playStream(stream);

	dispatcher.on('end', () => {
		queue.splice(0, 1)
		if (queue.length > 0) {
			playVideo(connection, message)
		} else {
			connection.disconnect();
		}
	});
}
module.exports = {
	currentVoice: null,
	//Sound effects
	play: function (sound, message) {
		var emoji = message.guild.emojis.find('name', 'tnt');
		if (emoji === null) {
			emoji = '';
		}
		var channel = message.member.voiceChannel;

		if (typeof channel !== "undefined") {
			if (sound === 'hello') {
				channel.join()
				.then(connection => {
					dispatcher = connection.playFile('./sound/hello.wav');
					dispatcher.on('end', () => connection.disconnect());
				})
				.catch (console.error);
			}
			if (sound === 'tnt') {
				channel.join()
				.then(connection => {
					dispatcher = connection.playFile('./sound/explosion.wav');
					dispatcher.on('end', () => {
						connection.disconnect();
						message.reply('Boom! ' + emoji);
					});
				})
				.catch (console.error);
			}
			currentVoice = channel;
		} else if (sound === 'tnt') {
			message.reply('Boom! ' + emoji);
		}
	},
	//Get YouTube video
	playYoutube: function (message, link) {
		var regex = /^(http(s)??\:\/\/)?(www\.)?((youtube\.com\/watch\?v=)|(youtu.be\/))([a-zA-Z0-9\-_])+/
		if (regex.test(link[0])) {
			//Direct link to video
			addToQueue(message, link[0]);
		} else {
			//Search the video with the YouTube API
			var video = 'https://www.googleapis.com/youtube/v3/search?part=snippet&q=[' + link + ']&maxResults=1&type=video&key=' + config.youtubeAPIKey;
			get(video).then(function(response) {
				var url = 'https://www.youtube.com/watch?v=' + response.items[0].id.videoId
				addToQueue(message, url);
			});
		}
	},
	//Stop playing the audio and leave channel
	stop: function (message) {
		var channel = message.member.voiceChannel;
		if (typeof channel !== "undefined" && channel.connection != null) {
			channel.connection.disconnect();
			queue = [];
			bot.printMsg(message, 'Disconnected!');
		}
	},
	//Skip song
	skip: function (message) {
		//Ugly solution, but it's the only one
		try {
			var dispatcherStream = message.member.voiceChannel.connection.player.dispatcher.stream;
			dispatcherStream.destroy();
			bot.printMsg(message, 'Song skipped!');
		} catch(stream){}
	},
	listQueue: function(message) {
		var titles = '**List of videos in queue:**';
		//Get video titles
		for(i = 0; i < queue.length; i++) {
			titles += '\n "' + queue[i][1] + '"';
		}
		//Write titles
		message.channel.send(titles);
	}
}
