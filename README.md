<h1 align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/cachet/master/.github/images/cachet.webp" width="200" alt="Logo"/><br/>
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/master/.github/images/transparent.png" height="45" width="0px"/>
    Cachet
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/master/.github/images/transparent.png" height="30" width="0px"/>
</h1>

<p align="center">
    <i><b>noun</b> - A mark or quality, as of distinction, individuality, or authenticity.</i>
</p>

<p align="center">
	<img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/master/.github/images/line-break-thin.svg" />
</p>

## What's this?

Cachet is a cache / proxy for profile pictures and emojis on the hackclub slack! I made it because calling the slack api every time you want a profile image or emoji is expensive and annoying. Now you can just call the cachet api and get a link to the image or emoji you want! Best of all we are just linking to slack's cdn so it doesn't cost me much of anything (besides db space) to run!

## How do I use it?

Well first the question is how do I host it lol.

### Hosting

I'm hosting on nest so I just setup a systemd service file that runs `bun run index.ts` in the root dir of this repo. Then I setup caddy to reverse proxy `cachet.dunkirk.sh` to the app.

Your `.env` file should look like this:

```bash
SLACK_TOKEN=xoxb-123456789012-123456789012-123456789012-123456789012
SLACK_SIGNING_SECRET=12345678901234567890123456789012
PORT=3000
```

The slack app can be created from the [`manifest.yaml`](./manifest.yaml) in this repo. It just needs the `emoji:read` and `users:read` scopes.

### Usage

The api is pretty simple. You can get a profile picture by calling `GET /profile/:id` where `:id` is the slack user id. You can get an emoji by calling `GET /emoji/:name` where `:name` is the name of the emoji. You can also get a list of all emojis by calling `GET /emojis`. (WIP - subject to rapid change)

There are also complete swagger docs available at `/swagger`! They are dynamically generated from the code so they should always be up to date! (The types force me to keep them up to date ^_^)

## How does it work?

The app is honestly super simple. It's pretty much just a cache layer on top of the slack api. When you request a profile picture or emoji it first checks the cache. If the image is in the cache it returns the link to the image. If the image is not in the cache it calls the slack api to get the link to image and then stores that in the cache before returning the image link to you!

<p align="center">
	<img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/master/.github/images/line-break.svg" />
</p>

<p align="center">
	&copy 2024-present <a href="https://github.com/taciturnaxolotl">Kieran Klukas</a>
</p>

<p align="center">
	<a href="https://github.com/taciturnaxolotl/carriage/blob/master/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=AGPL 3.0&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
