# Twitch Lite for webOS

A lightweight Twitch client for LG webOS TVs. No frameworks: a single `index.html` of about 130 KB, native `<video>` for HLS (with hls.js loaded on demand for ad blocking and muted VODs), and a chat built for modest hardware.

![Twitch Lite home screen on an LG webOS TV](docs/screenshot-home.png)

> **Unofficial.** Twitch Lite is an independent project. It is not made by, endorsed by or affiliated with Twitch Interactive, Inc.

## What it does

Twitch Lite lets you watch Twitch on an LG TV without the heavy official app, and it stays smooth even on entry-level sets.

**Find something to watch**
- **Home** shows the most-watched live streams, **Categories** lets you browse by game, and **Search** finds any channel.
- Content is shown in your TV's language (you can switch it to everything in the settings), and the interface is in English or Spanish.
- Number keys on the remote jump straight to each tab. **Entering a tab always reloads it** (OK on the tab, its number key, or Back to Home), whether you had opened it before or not, so you always get fresh content. Going back from a **live stream** reloads the list you came from (Following, Home or a category), keeping the focus on the same position. Going back out of a VOD, a channel or a category brings back the previous list as you left it.

**Watch live streams and past broadcasts**
- Live streams and videos (VODs) play in the quality you choose, with simple on-screen buttons and Magic Remote support.
- A video **picks up where you left it**, even if you started it on your phone or PC.
- You can skip forward and back in steps that grow the longer you hold the key.
- If a stream freezes, the app recovers on its own.

**Fewer interruptions**
- **Ads are blocked by default** on live streams. If an ad slips through, the sound is muted until it ends. You can turn this off in the settings. It depends on how Twitch serves ads today, so it may not catch every one.
- Parts of a video that Twitch muted get their sound back, and subscriber-only videos can still be played (both optional, at your own risk; see below).

**A chat made for the TV**
- A read-only chat for live streams, and for past broadcasts a **replay of the original chat** that follows the video: skip ahead and it jumps with you.
- **Emotes from Twitch, 7TV, BetterTTV and FrankerFaceZ** appear as images, on by default. They are small and cached so the TV does not slow down.
- Choose the text size, width, height, corner of the screen and background transparency.

**Your account (optional)**
- Sign in by scanning a QR code with your phone: no typing on the remote. Then you get **Following**, your followed channels' videos, and channel points collected automatically while you watch (this uses Twitch's private API; see below).
- **Live alerts**: while you watch a video or a live stream, a small message with the channel's picture (and a short beep) tells you when another channel you follow goes live, and you can jump to it or dismiss it. It is on by default, you can turn it off, mute the beep or choose how often it checks in the settings, and it is built to cost almost nothing (see [Live alerts](#live-alerts)).

**Light on purpose**
- It starts quickly, loads only what it needs, and keeps memory use low, so it works well on TVs with little RAM.

## Install

1. Download `com.twitchlite.app_1.2.0_all.ipk` from the [latest release](https://github.com/adamff-dev/twitch-lite-webos/releases/latest).
2. On your TV, install the **Developer Mode** app from the LG Content Store and turn Developer Mode on.
3. Install the [webOS TV CLI (ares)](https://webostv.developer.lge.com/develop/tools/cli-installation) and connect to your TV:

```sh
ares-setup-device                                              # add the TV once (IP, passphrase from Developer Mode)
ares-install -d <tv> com.twitchlite.app_1.2.0_all.ipk
ares-launch  -d <tv> com.twitchlite.app
```

To build from source instead: `npm install && npm run package`, which creates `out/com.twitchlite.app_1.2.0_all.ipk`.

## Login with Twitch (QR)

The app uses Twitch's *Device Code Grant*: the TV shows a QR code and a short code, you scan the QR with your phone, sign in, and the TV is linked. The only permission requested is `user:read:follows`.

By default it signs in with the **Client ID of the Twitch TV app** (`app/js/config.js`). That is the only client whose token also works with the private GraphQL API that the automatic channel points need. This is why the Twitch authorization page shows the official Twitch TV app as the requesting application.

> **Warning:** using the official client and the private API is not allowed by Twitch's terms and may stop working at any time or affect your account. It is your decision.

Official alternative: register your own app at https://dev.twitch.tv/console (**Client Type: Public**, redirect `http://localhost`) and build with `TWITCH_CLIENT_ID=your_id npm run package`. Everything works the same **except the automatic channel points**.

Without signing in you can use Home, Categories and Search. Following and Videos require signing in.

## Automatic channel points

While you watch a live stream with an active session, the app does two things every 60 seconds, only while the video is actually playing: it sends Twitch the same "minute-watched" viewing signal its own player sends (without it Twitch does not count your watch time, so no points accumulate and no chest ever appears), and it checks for a bonus chest and claims it automatically. A banner appears in the player (`+50 points · 1,234`). Both rely on undocumented Twitch endpoints and may stop working at any time. To turn this off, set `localStorage.setItem('ptsOff', '1')` in the app's storage.

## Muted VOD segments and sub-only VODs

Two workarounds are included for VODs. They bypass Twitch restrictions, may stop working at any time and may violate Twitch's terms. Use them at your own risk.

- **Muted VOD segments.** When a VOD is detected as muted, the player loads `js/hls.light.min.js` (hls.js 0.14.17, about 170 KB) only for that video and plays it through MSE. The media playlist is rewritten so segment URLs point to the original, unmuted files; if an original is no longer available (403/404), it falls back to the muted segment. If hls.js cannot start, the native player is used and the VOD stays muted. Twitch usually keeps the original segments for about 24 hours, sometimes less. You can turn this off in **Settings > Restore muted audio**.
- **Sub-only VODs.** If the playback token is missing or usher returns 403, the app reads the public `video` GraphQL data (`broadcastType`, `createdAt`, `seekPreviewsURL`, `owner.login`), rebuilds the CDN media playlists for the qualities that exist and plays the first one. The quality menu still lists the qualities found. This only works while those CDN files are public.

hls.js is shipped separately in `app/js/hls.light.min.js`; the build copies it to `dist/js/` instead of inlining it, so the app still loads a single file at startup and only fetches hls.js when a muted VOD needs it. hls.js is © its authors, licensed under [Apache-2.0](https://github.com/video-dev/hls.js/blob/master/LICENSE).

## Language

The interface is available in **English** and **Spanish**. It follows the TV's system language (Spanish if it starts with `es`, English otherwise). There is no language switch: if you change the TV language while the app is open, the interface updates by itself.

**Content from your country.** Home, and the live streams of a category, show channels that broadcast in your system language (for example Spanish for `es-ES`, Portuguese for `pt-BR`). It uses Twitch's broadcaster-language filter, which works on the language the streamer sets, not on their country. If nobody is live in that language, Home shows everything. The category list is not filtered, because Twitch does not offer that filter for categories. Languages Twitch has no filter for (for example Hebrew) show everything. To turn the filter off, see **Settings > Content from my country > Everything**.

Translations live in `app/js/i18n.js`. To add a language, copy the `en` block and translate it.

## Screens

| Tab | Content |
|---|---|
| Home | Most-watched live streams in your language (see [Content from your country](#language)) |
| Categories | Categories, then their live streams (filtered by your language) |
| Following | Live streams from the channels you follow (requires sign-in) |
| Videos | Your followed channels, then their past broadcasts (VODs). A channel that is live appears first |
| Search | Channels (live ones first), then their videos |
| Sign in / account | QR sign-in, or sign out |

## Remote control

**Navigation**

| Key | Action |
|---|---|
| Arrows / OK | Move / open. Pressing Down from the tabs returns to the last card. OK on a tab reloads it |
| Back | Previous view → tabs → Home (reloaded) → a hint; press Back again to close the app |
| 1 – 6 | Home, Categories, Following, Videos, Search, Account (Sign in / your user). Home to Videos reload the tab |
| CH+ / CH− (or Page Up / Page Down) | Jump 3 rows |
| Yellow | On a live stream: show that channel's videos |
| Red | Refresh the current tab (same as choosing it again). In the player: show or hide the chat |
| Green | Settings (also inside the player, so you can watch the chat while you change them) |

**Player**

All controls are buttons in the bottom panel. The panel hides itself after a few seconds (4 s by default) and stays visible while paused.
The buttons are **◀ 10 s · Pause/Play · 10 s ▶** (VOD only), **Quality**, **Chat** and **Exit**.

| Key | Action |
|---|---|
| ◀ ▶ | Move focus between the buttons. With the panel hidden, it only shows the panel |
| ▲ ▼ | On a VOD, move between the buttons and the progress bar |
| OK | Press the focused button. With the panel hidden, pauses or resumes |
| ◀ ▶ on the progress bar (VOD) | Skip ±10 s. **Press repeatedly to skip further**: 10, 10, 30, 30, 60, 60, 120, 120, 300 s. One seek is applied when you stop pressing |
| Red | Show or hide the chat (on a live stream and on a VOD), without bringing up the panel |
| Back | Closes the quality menu; otherwise exits the player |
| Yellow / Blue | While a [live alert](#live-alerts) is on screen: watch that channel / dismiss the alert |
| ▲ at the top of the panel | While a live alert is on screen: move the focus to it. Then ◀ ▶ choose Watch or Close, OK presses, ▼ or Back returns to the player |
| Play / Pause / Stop / ⏪ ⏩ | Media keys keep working (⏪ ⏩ skip at least 30 s) |

The Magic Remote pointer works too: moving it shows the panel, and you can click buttons and qualities.
On a live stream, resuming after a pause of more than 2 s jumps to the live edge (after 30 s or more the stream is reloaded). 

**Resuming VODs.** A VOD continues where you left it (not if you finished it or watched under 15 s). The position is stored on the TV; when you are signed in with the default Twitch TV client it is also read from Twitch (`video.self.viewingHistory`), so a VOD you left on your phone or PC resumes on the TV, and the most recent position wins. Twitch exposes no public operation to *write* that position, so what you watch on the TV stays on the TV.

**Ads.** During an ad on a live stream (detected from the HLS playlist: `stitched-ad` date ranges or ad-titled segments) the audio is muted and restored when the ad ends. **Settings > Block ads** is on by default and tries to remove the ad (see below); with it off, the ad plays.

**Blocking ads (on by default, optional).** With **Block ads** on (the default), live streams play through hls.js (loaded on demand, like for muted VODs) and a playlist loader removes the ad segments (segments whose title is not `live`), the `stitched-ad` date ranges and the prefetch hints from the media playlist. Mid-roll ads replace the stream instead of being interleaved with it: the playlist holds the last segments of the stream followed by ad segments, and soon nothing but ad segments, so removing them would leave the player without data. As soon as an ad segment shows up after stream segments, the app asks Twitch for the playlist of the same channel with the `picture-by-picture` player type, which is served without ads (at a lower quality, 360p at most, which comes back to normal when the ad ends), and plays that one meanwhile. If that request fails, the original playlist is kept so the player is never left without data: that ad plays, muted. While blocking, the audio is only muted in that case. If hls.js cannot start, the native player is used. **Player type (usher)** changes the `player` parameter sent to usher (*Twitch Web* by default, *HTML5*, *Web* or *Site*); Twitch may serve fewer ads to some of them. When you are signed in with the default Twitch TV client, the playback token is requested with your account, like the official player does; otherwise it is requested anonymously (which can bring a start-up ad).

**Stalls.** If a live stream stops receiving data for 8 s, the player jumps to the live edge and, if it is still stuck, reloads the stream.

## Live alerts

When you are signed in and watching something (a VOD or a live stream), the app tells you when **another channel you follow starts streaming**: a small box in the top-left corner with the channel's round picture, its name and the game, for 30 seconds, with a short beep so you do not miss it. Several channels that go live together are shown one after another (up to 3 per check). It does not take the focus or interrupt what you are watching, but you can act on it: click it with the Magic Remote pointer (or press **Yellow**) to switch to that live stream, and use the **×** (or press **Blue**) to dismiss it. With the arrow keys, press **Up** from the top of the player panel to move the focus to the alert, choose **Watch** or **Close** with ◀ ▶ and press OK; **Down** or Back gives the focus back to the player.

- It only runs **while the player is open and you are signed in**. On the menus nothing runs, and when the app goes to the background it stops asking.
- You are only told about channels that **start streaming while you are watching**. When you open the player it takes a first list of who is live, **without alerting**: channels that were already live (whether or not they were in your Following list) never trigger an alert. Only the ones that appear afterwards do. When you switch to another channel from an alert, that list is kept so nothing that just started is lost. The channel you are watching is never announced.
- Each check is **one small request** (`streams/followed`, Helix, 100 channels at most), every 1, 2, 5 or 10 minutes (**Settings > Check for live channels every**), never two at once. The picture is requested only when an alert is shown (70 px), and it is released when the box hides. Only the last 12 pictures stay in memory, and nothing is written to disk.
- It uses the same sign-in as **Following** (scope `user:read:follows`), so it works with any Client ID and needs nothing extra.
- Turn it off in **Settings > Alert me when followed channels go live**: with it off, no request is made.

## Settings

Press **Green** to open the settings. ▲ ▼ move between rows (the list scrolls when it does not fit, and the bar on the right shows where you are), ◀ ▶ change the value, OK goes to the next value, and Back or Green closes it. Changes apply immediately and are saved on the TV:

- **Tab on app start**: Home, Categories, Following or Videos.
- **Content from my country**: *Automatic* (the default: Home and category streams use your system language, see [Language](#language)) or *Everything*. Changing it reloads Home and Categories.
- **Restore muted audio**: *Yes* (the default) or *No*. See [Muted VOD segments and sub-only VODs](#muted-vod-segments-and-sub-only-vods).
- **Block ads**: *Yes* (the default) or *No*. See the **Ads** paragraphs above.
- **Player type (usher)**: *Twitch Web* (the default), *HTML5*, *Web* or *Site*. Changing it, or Block ads, reloads the live stream you are watching.
- **Alert me when followed channels go live**: *Yes* (the default) or *No*. See [Live alerts](#live-alerts).
- **Check for live channels every**: 1, 2 (the default), 5 or 10 min.
- **Live alert sound**: *Yes* (the default) or *No*. A short two-note beep made with Web Audio (no audio files); the audio context is created when the alert appears and closed right after.
- **Chat**:
  - emotes: *Yes* (the default) or *No*. See [Emotes](#emotes);
  - text size (4 levels);
  - width (5–100 % of the screen, in steps of 5);
  - height (5–100 % of the screen, in steps of 5; 100 % by default). The chat stays anchored to the top or bottom edge, depending on the position;
  - position (top or bottom, left or right);
  - background opacity (0–100 %; the text has a shadow so it stays readable on a transparent background).
- **Hide the player panel after**: 3, 4, 6, 10 or 15 s.
- **Credits**: the author, the project link and a QR code for donations. OK opens the screen and OK or Back returns to the settings. The donation link is `CONFIG.CREDITS.donate` in `app/js/config.js`; while it is empty, the QR points to the project page.
- **Restore default values**.

## Chat (read-only)

On a **live stream** it shows the live chat. On a **VOD** it shows the replay of the original chat, synchronized with the video: messages appear when the video reaches their second, and a seek (forward, backward or a quality change) reloads the chat from the new position. Nothing appears while paused.

Turn it on and off with the **Red** button (or the **Chat** button of the player panel). The preference is remembered. It is designed for modest TVs:

- a single WebSocket connection, **open only while the chat is visible**;
- **30 fixed DOM nodes that are recycled** (no elements are created or destroyed at runtime);
- at most **4 repaints per second** and 8 messages per repaint: during bursts, older messages are dropped;
- emotes as small static images with a bounded memory budget (see below), messages up to 160 characters, and an overlay panel (the video is not resized);
- disconnects when you leave the stream or when the app goes to the background.

### Emotes

Twitch, 7TV, BetterTTV and FrankerFaceZ emotes (channel and global ones) are shown as images in the chat, on live streams and in VOD replays. It is on by default (**Settings > Chat > Emotes**) and built so it does not pile up on a TV with little RAM:

- **static, small images only**: 2x size, animated 7TV emotes in their `_static.webp` version and BetterTTV ones as `.png` (their animated `.webp` can weigh megabytes), Twitch ones with the `static` format;
- **in-memory image cache with a hard limit**: at most **6 MiB** of decoded pixels (width × height × 4) and 250 distinct images; when it is full, the least recently used one is evicted and its bitmap released. The whole cache is emptied when you leave the stream, hide the chat or turn the setting off;
- **bounded downloads**: at most 6 images downloading at once (an emote that does not fit shows as text and as an image the next time), at most 10 images per message, a failed emote shows as text and is not retried for a minute;
- **compact dictionaries**: name → short code (never URLs or API objects), at most 3000 entries per channel. 7TV is queried through GraphQL asking only for id, name and animated flag, and the bulky `extensions` block of the response is discarded before parsing;
- **cached on the TV** (`localStorage`): channel dictionaries for 6 h and global ones for 24 h, up to 4 channels (the least recently used is deleted), so reopening a channel loads instantly without asking the network. A dictionary is not stored if any provider failed, so it is retried next time;
- if the setting is off, nothing is requested and no image is created.

## Development

```sh
npm test            # Chromium 53 compatibility + mocked network + UI flows in jsdom
npm run package     # builds dist/ and the .ipk in out/ (optional: TWITCH_CLIENT_ID=xxx)
ares-inspect -d <tv> com.twitchlite.app --open   # remote DevTools
```

Desktop testing: open `app/index.html` in Chrome (arrow keys, Enter, Esc/Backspace = Back).

The app targets webOS 4 and later (Chromium 53), so the code avoids `async/await`, spread, optional chaining and CSS grid. `npm test` checks this.

## Structure

- `app/js/api.js`: Twitch GraphQL (no sign-in needed), access token and HLS master playlist
- `app/js/auth.js`: Device Code Grant, token refresh, Helix (followed channels)
- `app/js/points.js`: automatic channel points claim (private GraphQL, needs the TV client)
- `app/js/qr.js`: our own QR generator (checked with OpenCV, see `tools/qr-check`)
- `app/js/chat.js`: optimized read-only chat (live IRC, and the synchronized replay for VODs)
- `app/js/emotes.js`: chat emotes (Twitch, 7TV, BTTV, FFZ) with a bounded image cache and cached dictionaries
- `app/js/ads.js`: detects ads in the live playlist (the player mutes the audio during them)
- `app/js/adblock.js`: optional ad blocking: hls.js playlist loader that removes ad segments from live streams
- `app/js/resume.js`: VOD resume position (local and, when available, from Twitch)
- `app/js/notify.js`: live alerts for followed channels while the player is open
- `app/js/unmute.js`: restores the audio of muted VOD segments (loads `hls.light.min.js` on demand)
- `app/js/settings.js`: settings (Green button)
- `app/js/credits.js`: credits screen (Settings > Credits), with the donation QR from `CONFIG.CREDITS` in `app/js/config.js`
- `app/js/login.js`, `player.js`, `app.js`: sign-in screen, player, views and remote control
- `app/js/i18n.js`: translations (English and Spanish)
- `tools/build.mjs`: inlines CSS and JS, minifies lightly and generates the icons

## Contribution

We welcome contributions of any kind — code, documentation, bug reports, or feature suggestions.

If you find this project helpful and want to support its development, consider making a donation.

Your support helps keep the project active and maintained. Thank you! 🙌

<div style="display: flex; gap: 10px;">
  <a target="_blank" href="https://www.buymeacoffee.com/rSiZtB3"><img style="height: 50px" src="https://i.imgur.com/KCk0bxY.png" /></a>
  <a target="_blank" href="https://www.paypal.com/donate/?hosted_button_id=3T9XNAPWW36Z2"><img style="height: 50px" src="https://i.imgur.com/Z3x38ey.png" /></a>
</div>

## Cryptocurrency Donations

You can also support the project with cryptocurrency:

- **Bitcoin:** `bc1qrcdyq2yjgv5alm9kky2e6vyfhnafn3wgd2gjls`
- **Ethereum:** `0x43b9649985d6789452abe23beb1eb610cee88817`
- **Solana:** `4qK7eSQemRj85VY9CQp5XHRwX5fNjoSJ1ou4gmqk6jtM`
- **Litecoin:** `ltc1qp6mya23a73n36dc7r0tfwfphn2v53phmhen99j`

## License

[MIT](LICENSE). The bundled hls.js is licensed under Apache-2.0.
